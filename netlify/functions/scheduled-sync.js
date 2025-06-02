// netlify/functions/scheduled-sync.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== SCHEDULED SYNC START ===');
  console.log('Event source:', event.httpMethod || 'scheduled');
  
  try {
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
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing required environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Try to refresh access token
    let currentToken = dropboxToken;
    if (dropboxRefreshToken && dropboxAppKey && dropboxAppSecret) {
      try {
        currentToken = await refreshAccessToken(dropboxRefreshToken, dropboxAppKey, dropboxAppSecret);
        console.log('✓ Refreshed access token');
      } catch (refreshError) {
        console.log('⚠ Failed to refresh token, using original');
        currentToken = dropboxToken;
      }
    }
    
    // Test Dropbox access
    await testDropboxAccess(currentToken);
    console.log('✓ Dropbox access verified');
    
    // Get current database state
    const { data: existingImages } = await supabase
      .from('portfolio_images')
      .select('path, modified');
    
    const existingPaths = new Set((existingImages || []).map(img => img.path));
    console.log(`Current database has ${existingPaths.size} images`);
    
    // Scan Dropbox for all images (no limits in scheduled sync)
    const portfolioPath = '/aboutcontact/website/portfolio';
    console.log('Starting full portfolio scan...');
    
    const allImages = await scanDropboxPortfolioFull(currentToken, portfolioPath, existingPaths);
    console.log(`Found ${allImages.length} total images in Dropbox`);
    
    if (allImages.length > 0) {
      // Clear and rebuild database
      console.log('Rebuilding database...');
      
      const { error: deleteError } = await supabase
        .from('portfolio_images')
        .delete()
        .neq('id', '');
      
      if (deleteError) {
        console.error('Delete error:', deleteError);
      }
      
      // Insert in batches
      const batchSize = 100;
      let insertedCount = 0;
      
      for (let i = 0; i < allImages.length; i += batchSize) {
        const batch = allImages.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('portfolio_images')
          .insert(batch);
        
        if (insertError) {
          console.error(`Batch ${i} insert error:`, insertError);
        } else {
          insertedCount += batch.length;
          console.log(`✓ Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allImages.length/batchSize)} (${insertedCount} total)`);
        }
      }
      
      console.log(`✓ Successfully inserted ${insertedCount} images`);
    }
    
    // Update metadata
    const projects = [...new Set(allImages.map(img => img.project))];
    
    const { error: metaError } = await supabase
      .from('portfolio_meta')
      .upsert({
        last_sync: new Date().toISOString(),
        total_images: allImages.length,
        projects: JSON.stringify(projects)
      });
    
    if (metaError) {
      console.error('Meta update error:', metaError);
    }
    
    console.log('=== SCHEDULED SYNC COMPLETE ===');
    console.log(`Synced ${allImages.length} images across ${projects.length} projects`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        synced: allImages.length,
        projects: projects.length,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== SCHEDULED SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
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
    throw new Error(`Token refresh failed: ${response.status}`);
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
    throw new Error(`Dropbox access failed: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

async function scanDropboxPortfolioFull(token, basePath, existingPaths) {
  const images = [];
  
  try {
    // Get all project folders
    const projectFolders = await listDropboxFolder(token, basePath);
    const actualProjects = projectFolders.filter(item => item['.tag'] === 'folder');
    
    console.log(`Found ${actualProjects.length} project folders`);
    
    for (const project of actualProjects) {
      const projectName = project.name;
      const projectPath = project.path_lower;
      console.log(`📁 Scanning project: ${projectName}`);
      
      try {
        // Get tool subfolders
        const toolFolders = await listDropboxFolder(token, projectPath);
        const actualTools = toolFolders.filter(item => item['.tag'] === 'folder');
        
        console.log(`  Found ${actualTools.length} tool folders in ${projectName}`);
        
        for (const tool of actualTools) {
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`  🔧 Scanning: ${projectName}/${toolName}`);
          
          try {
            // Get all files in tool folder
            const files = await listDropboxFolder(token, toolPath);
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              const extension = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
            });
            
            console.log(`    📸 Found ${imageFiles.length} images`);
            
            for (const file of imageFiles) {
              // Skip if already processed and not modified
              if (existingPaths.has(file.path_lower)) {
                continue;
              }
              
              try {
                // Generate temporary URL
                const imageUrl = await getDropboxTemporaryUrl(token, file.path_lower);
                
                // Get image dimensions if possible
                let aspectRatio = 1.33; // Default
                try {
                  aspectRatio = await getImageAspectRatio(imageUrl);
                } catch (err) {
                  console.log(`    ⚠ Could not get dimensions for ${file.name}`);
                }
                
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
                console.log(`    ✓ Added: ${imageData.name}`);
                
              } catch (imageError) {
                console.error(`    ✗ Error processing ${file.name}:`, imageError.message);
              }
            }
          } catch (toolError) {
            console.error(`  ✗ Error scanning tool ${toolPath}:`, toolError.message);
          }
        }
      } catch (projectError) {
        console.error(`✗ Error scanning project ${projectPath}:`, projectError.message);
      }
    }
  } catch (error) {
    console.error(`✗ Error scanning base path ${basePath}:`, error.message);
    throw error;
  }
  
  return images;
}

async function listDropboxFolder(token, path) {
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
    throw new Error(`Dropbox list_folder failed for ${path}: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
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
      throw new Error(`Failed to get temporary URL: ${response.status}`);
    }
    
    const data = await response.json();
    return data.link;
  } catch (error) {
    console.error(`Error getting temporary URL for ${path}:`, error.message);
    return null;
  }
}

async function getImageAspectRatio(imageUrl) {
  return new Promise((resolve) => {
    // Since we're in a server environment, we can't use Image()
    // We'll just use default ratios based on common formats
    // This could be enhanced with image processing libraries
    resolve(1.33);
  });
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