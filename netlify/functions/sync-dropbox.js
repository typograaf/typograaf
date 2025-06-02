// netlify/functions/sync-dropbox.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DROPBOX SYNC START ===');
  
  // Set timeout to prevent long-running function
  const timeoutMs = 8000; // 8 seconds to stay under 10s limit
  const startTime = Date.now();
  
  try {
    // Environment variables check
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    const dropboxRefreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const dropboxAppKey = process.env.DROPBOX_APP_KEY;
    const dropboxAppSecret = process.env.DROPBOX_APP_SECRET;
    
    console.log('Environment check:');
    console.log('- SUPABASE_URL exists:', !!supabaseUrl);
    console.log('- SUPABASE_ANON_KEY exists:', !!supabaseKey);
    console.log('- DROPBOX_ACCESS_TOKEN exists:', !!dropboxToken);
    console.log('- DROPBOX_REFRESH_TOKEN exists:', !!dropboxRefreshToken);
    console.log('- DROPBOX_APP_KEY exists:', !!dropboxAppKey);
    console.log('- DROPBOX_APP_SECRET exists:', !!dropboxAppSecret);
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    if (!dropboxToken) {
      throw new Error('Missing DROPBOX_ACCESS_TOKEN environment variable');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Try to get a fresh access token if we have refresh capability
    let currentToken = dropboxToken;
    
    if (dropboxRefreshToken && dropboxAppKey && dropboxAppSecret) {
      console.log('Attempting to refresh access token...');
      try {
        currentToken = await refreshAccessToken(dropboxRefreshToken, dropboxAppKey, dropboxAppSecret);
        console.log('Successfully refreshed access token');
      } catch (refreshError) {
        console.log('Failed to refresh token, using original:', refreshError.message);
        currentToken = dropboxToken;
      }
    }
    
    // Test Dropbox access
    console.log('Testing Dropbox access...');
    await testDropboxAccess(currentToken);
    console.log('Dropbox access OK');
    
    // Check how much time we have left
    const elapsed = Date.now() - startTime;
    const remainingTime = timeoutMs - elapsed;
    
    if (remainingTime < 2000) {
      throw new Error('Not enough time remaining for sync');
    }
    
    // Get existing sync state
    const { data: metaData } = await supabase
      .from('portfolio_meta')
      .select('*')
      .limit(1)
      .single();
    
    const lastSync = metaData?.last_sync;
    const isFirstSync = !lastSync;
    
    console.log('Sync state:', { isFirstSync, lastSync });
    
    // Scan Dropbox folder - use chunked approach
    const portfolioPath = '/aboutcontact/website/portfolio';
    console.log('Scanning portfolio path:', portfolioPath);
    
    const images = await scanDropboxPortfolioChunked(
      currentToken, 
      portfolioPath, 
      remainingTime - 1000, // Leave 1 second buffer
      isFirstSync
    );
    
    console.log(`Found ${images.length} images to sync`);
    
    if (images.length > 0) {
      // For first sync, clear existing data
      if (isFirstSync) {
        console.log('First sync - clearing existing portfolio data...');
        await supabase.from('portfolio_images').delete().neq('id', '');
      }
      
      // Insert new data in small batches
      console.log('Inserting new portfolio data...');
      const batchSize = 20;
      let inserted = 0;
      
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        
        // Use upsert to handle duplicates
        const { error } = await supabase
          .from('portfolio_images')
          .upsert(batch, { onConflict: 'id' });
          
        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }
        
        inserted += batch.length;
        console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(images.length/batchSize)} (${inserted} images)`);
        
        // Check if we're running out of time
        if (Date.now() - startTime > timeoutMs - 1000) {
          console.log('Running out of time, stopping sync');
          break;
        }
      }
    }
    
    // Update metadata
    const projects = [...new Set(images.map(img => img.project))];
    console.log('Projects found:', projects);
    
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: images.length,
      projects: JSON.stringify(projects),
      sync_incomplete: Date.now() - startTime > timeoutMs - 1000
    });
    
    // If sync was incomplete, trigger another round
    if (Date.now() - startTime > timeoutMs - 1000) {
      console.log('Sync incomplete, triggering continuation...');
      
      // Fire and forget - trigger another sync
      setTimeout(() => {
        fetch(`${process.env.URL}/.netlify/functions/sync-dropbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ continue: true })
        }).catch(console.error);
      }, 1000);
    }
    
    console.log('=== SYNC COMPLETE ===');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        synced: images.length,
        projects: projects,
        incomplete: Date.now() - startTime > timeoutMs - 1000,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

async function refreshAccessToken(refreshToken, appKey, appSecret) {
  const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

async function testDropboxAccess(token) {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Dropbox test failed:', response.status, errorText);
    
    if (response.status === 401) {
      if (errorText.includes('expired_access_token')) {
        throw new Error('Access token has expired. You need to set up refresh tokens for long-term access.');
      } else {
        throw new Error('Invalid access token. Please regenerate your Dropbox access token.');
      }
    }
    
    throw new Error(`Dropbox authentication failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('Dropbox user:', data.name?.display_name || 'Unknown');
  return data;
}

async function scanDropboxPortfolioChunked(token, basePath, timeLimit, isFirstSync) {
  const images = [];
  const startTime = Date.now();
  
  try {
    console.log('Listing base portfolio folder...');
    // Get project folders
    const projectFolders = await listDropboxFolder(token, basePath);
    console.log(`Found ${projectFolders.length} items in portfolio folder`);
    
    // Filter to folders only
    const folders = projectFolders.filter(item => item['.tag'] === 'folder');
    
    // For first sync, process more folders. For subsequent syncs, focus on recent changes
    const foldersToProcess = isFirstSync ? folders.slice(0, 6) : folders.slice(0, 3);
    
    console.log(`Processing ${foldersToProcess.length} projects (first sync: ${isFirstSync})`);
    
    for (const project of foldersToProcess) {
      // Check time limit
      if (Date.now() - startTime > timeLimit) {
        console.log('Time limit reached, stopping scan');
        break;
      }
      
      const projectName = project.name;
      const projectPath = project.path_lower;
      console.log(`Scanning project: ${projectName}`);
      
      try {
        // Get tool subfolders
        const toolFolders = await listDropboxFolder(token, projectPath);
        console.log(`Found ${toolFolders.length} tool folders in ${projectName}`);
        
        for (const tool of toolFolders) {
          // Check time limit again
          if (Date.now() - startTime > timeLimit) {
            console.log('Time limit reached in tool scanning');
            break;
          }
          
          if (tool['.tag'] !== 'folder') {
            continue;
          }
          
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            // Get images in tool folder
            const files = await listDropboxFolder(token, toolPath);
            console.log(`Found ${files.length} files in ${projectName}/${toolName}`);
            
            // Filter to image files
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              const extension = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
            });
            
            // Process images with time limit
            const maxImagesPerFolder = isFirstSync ? 8 : 5;
            const imagesToProcess = imageFiles.slice(0, maxImagesPerFolder);
            
            console.log(`Processing ${imagesToProcess.length} images from ${projectName}/${toolName}`);
            
            for (const file of imagesToProcess) {
              // Check time limit for each image
              if (Date.now() - startTime > timeLimit) {
                console.log('Time limit reached processing images');
                return images;
              }
              
              console.log(`Processing image: ${file.name}`);
              
              try {
                // Generate temporary URL with timeout
                const imageUrl = await Promise.race([
                  getDropboxTemporaryUrl(token, file.path_lower),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('URL generation timeout')), 2000)
                  )
                ]);
                
                // Estimate aspect ratio from filename or use default
                const aspectRatio = estimateAspectRatio(file.name);
                
                const imageData = {
                  id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
                  name: file.name.replace(/\.[^/.]+$/, ''),
                  project: projectName,
                  tool: toolName,
                  type: guessTypeFromTool(toolName),
                  time: guessTimeFromDate(file.client_modified),
                  aspectratio: aspectRatio,
                  path: file.path_lower,
                  size: file.size,
                  modified: file.client_modified,
                  extension: file.name.split('.').pop().toLowerCase(),
                  image_url: imageUrl,
                  scanned: new Date().toISOString()
                };
                
                images.push(imageData);
                console.log(`Added image: ${imageData.name} (${projectName}/${toolName})`);
                
                // Stop if we have enough images for this round
                if (images.length >= (isFirstSync ? 40 : 20)) {
                  console.log(`Reached ${images.length} images limit for this sync round`);
                  return images;
                }
                
              } catch (imageError) {
                console.error(`Error processing image ${file.name}:`, imageError.message);
                continue; // Skip this image and continue
              }
            }
          } catch (error) {
            console.error(`Error scanning tool folder ${toolPath}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Error scanning project ${projectPath}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`Error scanning base path ${basePath}:`, error.message);
    throw error;
  }
  
  return images;
}

async function listDropboxFolder(token, path) {
  console.log(`Listing folder: ${path}`);
  
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      path: path || '',
      recursive: false 
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Dropbox list_folder failed for ${path}:`, response.status, errorText);
    throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`Listed ${data.entries?.length || 0} items in ${path}`);
  return data.entries || [];
}

async function getDropboxTemporaryUrl(token, path) {
  try {
    const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path })
    });
    
    if (!response.ok) {
      console.error(`Failed to get temporary URL for ${path}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`Generated temporary URL for ${path}`);
    return data.link;
  } catch (error) {
    console.error(`Error getting temporary URL for ${path}:`, error.message);
    return null;
  }
}

function estimateAspectRatio(filename) {
  const lower = filename.toLowerCase();
  
  // Common aspect ratios based on filename patterns
  if (lower.includes('portrait') || lower.includes('vert')) return 3/4;
  if (lower.includes('landscape') || lower.includes('horiz')) return 16/9;
  if (lower.includes('square') || lower.includes('1x1')) return 1;
  if (lower.includes('wide') || lower.includes('banner')) return 21/9;
  if (lower.includes('story') || lower.includes('instagram')) return 9/16;
  
  // Default to common photo aspect ratio
  return 1.33;
}

function guessTypeFromTool(tool) {
  const toolMap = {
    'Blender': '3D',
    'Figma': 'Design',
    'Photoshop': 'Photo',
    'Illustrator': 'Vector',
    'InDesign': 'Layout',
    'Glyphs': 'Typography',
    'Photography': 'Photo',
    'Capture One': 'Photo',
    'After Effects': 'Motion',
    'Premiere': 'Video'
  };
  
  return toolMap[tool] || 'Design';
}

function guessTimeFromDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const quarter = Math.ceil((date.getMonth() + 1) / 3);
  
  return `${year}-Q${quarter}`;
}