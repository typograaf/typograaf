// netlify/functions/sync-dropbox.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DROPBOX SYNC START ===');
  
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
    
    // Scan Dropbox folder - use the correct lowercase path
    const portfolioPath = '/aboutcontact/website/portfolio';
    console.log('Scanning portfolio path:', portfolioPath);
    
    const images = await scanDropboxPortfolio(currentToken, portfolioPath);
    
    console.log(`Found ${images.length} images to sync`);
    
    if (images.length > 0) {
      // Clear existing data
      console.log('Clearing existing portfolio data...');
      const { error: deleteError } = await supabase.from('portfolio_images').delete().neq('id', '');
      if (deleteError) {
        console.error('Delete error:', deleteError);
      }
      
      // Insert new data in smaller batches
      console.log('Inserting new portfolio data...');
      const batchSize = 20;
      let totalInserted = 0;
      
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        const { error, data } = await supabase.from('portfolio_images').insert(batch);
        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }
        totalInserted += batch.length;
        console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(images.length/batchSize)} (${totalInserted}/${images.length} total)`);
      }
    }
    
    // Update metadata
    const projects = [...new Set(images.map(img => img.project))];
    console.log('Projects found:', projects);
    
    const { error: metaError } = await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: images.length,
      projects: JSON.stringify(projects)
    });
    
    if (metaError) {
      console.error('Meta update error:', metaError);
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

async function scanDropboxPortfolio(token, basePath) {
  const images = [];
  
  try {
    console.log('Listing base portfolio folder...');
    const projectFolders = await listDropboxFolder(token, basePath);
    console.log(`Found ${projectFolders.length} items in portfolio folder`);
    
    // Process ALL projects, but limit images per project to stay under timeout
    const projects = projectFolders.filter(item => item['.tag'] === 'folder');
    console.log(`Processing ${projects.length} projects`);
    
    for (const project of projects) {
      const projectName = project.name;
      const projectPath = project.path_lower;
      console.log(`Scanning project: ${projectName}`);
      
      try {
        const toolFolders = await listDropboxFolder(token, projectPath);
        console.log(`Found ${toolFolders.length} tool folders in ${projectName}`);
        
        let projectImageCount = 0;
        const maxImagesPerProject = 10; // Limit per project to stay under timeout
        
        for (const tool of toolFolders) {
          if (tool['.tag'] !== 'folder') continue;
          if (projectImageCount >= maxImagesPerProject) break;
          
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            const files = await listDropboxFolder(token, toolPath);
            console.log(`Found ${files.length} files in ${projectName}/${toolName}`);
            
            const imageFiles = files
              .filter(file => {
                if (file['.tag'] !== 'file') return false;
                const extension = file.name.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
              })
              .slice(0, Math.min(5, maxImagesPerProject - projectImageCount));
            
            console.log(`Processing ${imageFiles.length} images from ${projectName}/${toolName}`);
            
            for (const file of imageFiles) {
              console.log(`Processing image: ${file.name}`);
              
              // Generate temporary URL (but don't fail if it doesn't work)
              let imageUrl = null;
              try {
                imageUrl = await getDropboxTemporaryUrl(token, file.path_lower);
              } catch (urlError) {
                console.log(`Failed to get URL for ${file.name}: ${urlError.message}`);
              }
              
              // Guess aspect ratio from dimensions if possible, otherwise default
              const aspectRatio = guessAspectRatioFromFilename(file.name) || 1.33;
              
              const imageData = {
                id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-').toLowerCase(),
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
              projectImageCount++;
              console.log(`Added image: ${imageData.name} (${projectName}/${toolName}) - Total: ${images.length}`);
              
              // Global timeout protection - allow up to 50 images
              if (images.length >= 50) {
                console.log('Reached 50 images limit to avoid timeout');
                return images;
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
  const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ path })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get temporary URL: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`Generated temporary URL for ${path}`);
  return data.link;
}

function guessAspectRatioFromFilename(filename) {
  // Try to guess common aspect ratios from filename patterns
  const lower = filename.toLowerCase();
  if (lower.includes('16x9') || lower.includes('16-9')) return 16/9;
  if (lower.includes('4x3') || lower.includes('4-3')) return 4/3;
  if (lower.includes('square') || lower.includes('1x1')) return 1;
  if (lower.includes('portrait')) return 3/4;
  if (lower.includes('landscape')) return 16/9;
  return null; // Unknown
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