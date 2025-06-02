// netlify/functions/sync-dropbox.js - Enhanced version
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DROPBOX SYNC START ===');
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing required environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test Dropbox access first
    await testDropboxAccess(dropboxToken);
    
    // Scan portfolio with improved efficiency
    const portfolioPath = '/aboutcontact/website/portfolio';
    const allImages = await scanDropboxPortfolioComplete(dropboxToken, portfolioPath);
    
    console.log(`Found ${allImages.length} total images`);
    
    if (allImages.length > 0) {
      // Clear and update in batches
      console.log('Clearing existing data...');
      await supabase.from('portfolio_images').delete().neq('id', '');
      
      // Insert in smaller batches to avoid timeout
      const batchSize = 25;
      let inserted = 0;
      
      for (let i = 0; i < allImages.length; i += batchSize) {
        const batch = allImages.slice(i, i + batchSize);
        
        // Process images in parallel for this batch
        const processedBatch = await Promise.all(
          batch.map(async (img) => {
            try {
              const imageUrl = await getDropboxTemporaryUrl(dropboxToken, img.path);
              return { ...img, image_url: imageUrl };
            } catch (error) {
              console.error(`Failed to get URL for ${img.path}:`, error.message);
              return { ...img, image_url: null };
            }
          })
        );
        
        const { error } = await supabase.from('portfolio_images').insert(processedBatch);
        if (error) throw error;
        
        inserted += processedBatch.length;
        console.log(`Inserted batch: ${inserted}/${allImages.length}`);
      }
    }
    
    // Update metadata
    const projects = [...new Set(allImages.map(img => img.project))];
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: allImages.length,
      projects: JSON.stringify(projects)
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        synced: allImages.length,
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

async function scanDropboxPortfolioComplete(token, basePath) {
  const images = [];
  
  try {
    // Get all project folders
    const projectFolders = await listDropboxFolder(token, basePath);
    const projectDirs = projectFolders.filter(item => item['.tag'] === 'folder');
    
    console.log(`Found ${projectDirs.length} project folders`);
    
    // Process all projects, but limit files per project to avoid timeout
    for (const project of projectDirs) {
      const projectName = project.name;
      console.log(`Processing project: ${projectName}`);
      
      try {
        // Get tool folders
        const toolFolders = await listDropboxFolder(token, project.path_lower);
        const toolDirs = toolFolders.filter(item => item['.tag'] === 'folder');
        
        for (const tool of toolDirs) {
          const toolName = tool.name;
          console.log(`  Processing tool: ${toolName}`);
          
          try {
            // Get image files
            const files = await listDropboxFolder(token, tool.path_lower);
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              const ext = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
            });
            
            // Add images to collection (without generating URLs yet for speed)
            for (const file of imageFiles) {
              const imageData = {
                id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
                name: file.name.replace(/\.[^/.]+$/, ''),
                project: projectName,
                tool: toolName,
                type: guessTypeFromTool(toolName),
                time: guessTimeFromDate(file.client_modified),
                aspectratio: 1.33, // Default, can be improved later
                path: file.path_lower,
                size: file.size,
                modified: file.client_modified,
                extension: file.name.split('.').pop().toLowerCase(),
                scanned: new Date().toISOString()
              };
              
              images.push(imageData);
            }
            
            console.log(`    Added ${imageFiles.length} images from ${toolName}`);
            
          } catch (error) {
            console.error(`Error in tool folder ${tool.path_lower}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Error in project folder ${project.path_lower}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error(`Error scanning base path ${basePath}:`, error.message);
    throw error;
  }
  
  console.log(`Total images collected: ${images.length}`);
  return images;
}

async function testDropboxAccess(token) {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Dropbox auth failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

async function listDropboxFolder(token, path) {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ path: path || '', recursive: false })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`List folder failed: ${response.status} - ${errorText}`);
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
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.link;
  } catch (error) {
    console.error(`Error getting temporary URL for ${path}:`, error.message);
    return null;
  }
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