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
    
    // Get sync progress from database
    const { data: metaData } = await supabase
      .from('portfolio_meta')
      .select('*')
      .limit(1)
      .single();
    
    const lastSync = metaData?.last_sync;
    const syncProgress = metaData?.sync_progress || 0; // Track which project we're on
    const isFirstSync = !lastSync || syncProgress === 0;
    
    console.log('Sync state:', { isFirstSync, lastSync, syncProgress });
    
    // Scan Dropbox folder with continuation
    const portfolioPath = '/aboutcontact/website/portfolio';
    console.log('Scanning portfolio path:', portfolioPath);
    
    const { images, nextProgress, allComplete } = await scanDropboxPortfolioContinuous(
      currentToken, 
      portfolioPath, 
      remainingTime - 1000, // Leave 1 second buffer
      syncProgress
    );
    
    console.log(`Found ${images.length} new images to sync`);
    
    if (images.length > 0) {
      // Insert new data in small batches (use upsert to avoid duplicates)
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
    
    // Update metadata with progress
    const projects = [...new Set(images.map(img => img.project))];
    console.log('Projects processed in this round:', projects);
    
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      sync_progress: allComplete ? 0 : nextProgress, // Reset to 0 when complete
      projects: JSON.stringify(projects),
      sync_complete: allComplete
    });
    
    // If sync is not complete, trigger continuation
    if (!allComplete) {
      console.log(`Sync incomplete, progress: ${nextProgress}. Triggering continuation...`);
      
      // Fire and forget - trigger another sync round after short delay
      setTimeout(() => {
        fetch(`${process.env.URL}/.netlify/functions/sync-dropbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ continue: true, progress: nextProgress })
        }).catch(console.error);
      }, 2000); // 2 second delay between rounds
    } else {
      console.log('Sync complete! All projects processed.');
    }
    
    console.log('=== SYNC ROUND COMPLETE ===');
    
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
        complete: allComplete,
        progress: `${nextProgress}/${20}`, // Assuming ~20 total projects
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

async function scanDropboxPortfolioContinuous(token, basePath, timeLimit, startFromProject = 0) {
  const images = [];
  const startTime = Date.now();
  
  try {
    console.log('Listing base portfolio folder...');
    // Get all items in portfolio folder
    const allItems = await listDropboxFolder(token, basePath);
    console.log(`Found ${allItems.length} total items in portfolio folder`);
    
    // Filter to folders only and sort for consistent processing
    const projectFolders = allItems
      .filter(item => item['.tag'] === 'folder')
      .sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`Total project folders: ${projectFolders.length}`);
    console.log(`Starting from project ${startFromProject}`);
    
    // Process projects starting from the given index
    let currentProject = startFromProject;
    let allComplete = false;
    
    for (let i = startFromProject; i < projectFolders.length; i++) {
      // Check time limit before processing each project
      if (Date.now() - startTime > timeLimit) {
        console.log(`Time limit reached at project ${i}/${projectFolders.length}`);
        break;
      }
      
      const project = projectFolders[i];
      const projectName = project.name;
      const projectPath = project.path_lower;
      
      console.log(`Processing project ${i + 1}/${projectFolders.length}: ${projectName}`);
      
      try {
        // Get tool subfolders
        const toolFolders = await listDropboxFolder(token, projectPath);
        console.log(`Found ${toolFolders.length} items in ${projectName}`);
        
        // Process each tool folder
        for (const tool of toolFolders) {
          // Check time limit
          if (Date.now() - startTime > timeLimit) {
            console.log('Time limit reached in tool processing');
            break;
          }
          
          if (tool['.tag'] !== 'folder') {
            // Sometimes there are files directly in project folder
            if (tool['.tag'] === 'file' && isImageFile(tool.name)) {
              console.log(`Found direct image in project: ${tool.name}`);
              
              try {
                const imageUrl = await getDropboxTemporaryUrl(token, tool.path_lower);
                const aspectRatio = estimateAspectRatio(tool.name);
                
                const imageData = {
                  id: `${projectName}-direct-${tool.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
                  name: tool.name.replace(/\.[^/.]+$/, ''),
                  project: projectName,
                  tool: 'Direct', // For files directly in project folder
                  type: guessTypeFromProjectName(projectName),
                  time: guessTimeFromDate(tool.client_modified),
                  aspectratio: aspectRatio,
                  path: tool.path_lower,
                  size: tool.size,
                  modified: tool.client_modified,
                  extension: tool.name.split('.').pop().toLowerCase(),
                  image_url: imageUrl,
                  scanned: new Date().toISOString()
                };
                
                images.push(imageData);
                console.log(`Added direct image: ${imageData.name}`);
              } catch (error) {
                console.error(`Error processing direct image ${tool.name}:`, error.message);
              }
            }
            continue;
          }
          
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            // Get files in tool folder
            const files = await listDropboxFolder(token, toolPath);
            console.log(`Found ${files.length} files in ${projectName}/${toolName}`);
            
            // Filter to image files - be more permissive and add debugging
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              
              const filename = file.name;
              const isImage = isImageFile(filename);
              
              // Debug: log files that aren't detected as images
              if (!isImage) {
                console.log(`Skipping non-image file: ${filename} (extension: ${filename.split('.').pop().toLowerCase()})`);
              }
              
              return isImage;
            });
            
            console.log(`Found ${imageFiles.length} image files in ${projectName}/${toolName}`);
            
            // Debug: log the actual filenames we found
            if (imageFiles.length > 0) {
              console.log(`Image files: ${imageFiles.map(f => f.name).join(', ')}`);
            } else if (files.length > 0) {
              console.log(`All files in folder: ${files.map(f => f.name).join(', ')}`);
            }
            
            // Process all images in this folder (no artificial limits)
            for (const file of imageFiles) {
              // Check time limit for each image
              if (Date.now() - startTime > timeLimit - 500) {
                console.log('Time limit approaching, stopping image processing');
                return { images, nextProgress: currentProject, allComplete: false };
              }
              
              console.log(`Processing image: ${file.name}`);
              
              try {
                // Generate temporary URL with timeout
                const imageUrl = await Promise.race([
                  getDropboxTemporaryUrl(token, file.path_lower),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('URL generation timeout')), 3000)
                  )
                ]);
                
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
                
              } catch (imageError) {
                console.error(`Error processing image ${file.name}:`, imageError.message);
                continue; // Skip this image and continue
              }
            }
          } catch (error) {
            console.error(`Error scanning tool folder ${toolPath}:`, error.message);
          }
        }
        
        currentProject = i + 1;
        
      } catch (error) {
        console.error(`Error scanning project ${projectPath}:`, error.message);
        currentProject = i + 1; // Move to next project even if this one failed
      }
    }
    
    // Check if we completed all projects
    allComplete = currentProject >= projectFolders.length;
    
    console.log(`Processed projects ${startFromProject} to ${currentProject - 1} of ${projectFolders.length}`);
    console.log(`All complete: ${allComplete}`);
    
    return { 
      images, 
      nextProgress: currentProject, 
      allComplete 
    };
    
  } catch (error) {
    console.error(`Error scanning base path ${basePath}:`, error.message);
    throw error;
  }
}

function isImageFile(filename) {
  if (!filename || typeof filename !== 'string') return false;
  
  // Handle files without extensions or weird naming
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;
  
  const extension = parts[parts.length - 1];
  
  const imageExtensions = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'svg', 
    'heic', 'heif', 'jfif', 'pjpeg', 'pjp', 'ico', 'cur', 'dds', 'raw', 'cr2', 
    'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw', 'x3f'
  ];
  
  return imageExtensions.includes(extension);
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
    'Premiere': 'Video',
    'Webflow': 'Web',
    'Cavalry': 'Motion'
  };
  
  return toolMap[tool] || 'Design';
}

function guessTypeFromProjectName(projectName) {
  const lower = projectName.toLowerCase();
  
  if (lower.includes('wood')) return 'Product';
  if (lower.includes('body') || lower.includes('bbody')) return 'Product';
  if (lower.includes('cold') || lower.includes('chain')) return 'Brand';
  if (lower.includes('typo')) return 'Typography';
  if (lower.includes('photo')) return 'Photo';
  
  return 'Design';
}

function guessTimeFromDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const quarter = Math.ceil((date.getMonth() + 1) / 3);
  
  return `${year}-Q${quarter}`;
}