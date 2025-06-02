// netlify/functions/sync-dropbox-chunks.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== ULTRA-FAST CHUNKED SYNC START ===');
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get the chunk parameter (which project to process)
    const chunk = parseInt(event.queryStringParameters?.chunk || '0');
    
    console.log(`Processing chunk ${chunk} (1 project per chunk)`);
    
    // Get all project folders first
    const portfolioPath = '/aboutcontact/website/portfolio';
    const allProjects = await listDropboxFolder(dropboxToken, portfolioPath);
    const projectFolders = allProjects.filter(item => item['.tag'] === 'folder');
    
    console.log(`Total projects: ${projectFolders.length}`);
    
    // Process only 1 project per function call
    const projectToProcess = projectFolders[chunk];
    
    if (!projectToProcess) {
      console.log('No more projects to process');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          completed: true,
          chunk: chunk,
          totalProjects: projectFolders.length
        })
      };
    }
    
    const images = [];
    const projectName = projectToProcess.name;
    const projectPath = projectToProcess.path_lower;
    
    console.log(`Processing project: ${projectName}`);
    
    try {
      const toolFolders = await listDropboxFolder(dropboxToken, projectPath);
      console.log(`Found ${toolFolders.length} tool folders in ${projectName}`);
      
      // Limit to first 2 tool folders to avoid timeout
      const limitedTools = toolFolders
        .filter(item => item['.tag'] === 'folder')
        .slice(0, 2);
      
      for (const tool of limitedTools) {
        const toolName = tool.name;
        const toolPath = tool.path_lower;
        console.log(`Scanning tool folder: ${projectName}/${toolName}`);
        
        try {
          const files = await listDropboxFolder(dropboxToken, toolPath);
          
          // Limit to first 3 images per tool folder
          const imageFiles = files
            .filter(file => {
              if (file['.tag'] !== 'file') return false;
              const extension = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
            })
            .slice(0, 3); // Max 3 images per tool
          
          console.log(`Processing ${imageFiles.length} images from ${projectName}/${toolName}`);
          
          for (const file of imageFiles) {
            console.log(`Processing: ${file.name}`);
            
            // Skip URL generation for now to save time - we'll add it later
            const imageData = {
              id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
              name: file.name.replace(/\.[^/.]+$/, ''),
              project: projectName,
              tool: toolName,
              type: guessTypeFromTool(toolName),
              time: guessTimeFromDate(file.client_modified),
              aspectratio: 1.33, // Default
              path: file.path_lower,
              size: file.size,
              modified: file.client_modified,
              extension: file.name.split('.').pop().toLowerCase(),
              image_url: null, // Will be generated later by a separate function
              scanned: new Date().toISOString()
            };
            
            images.push(imageData);
            
            // Stop if we have enough images to avoid timeout
            if (images.length >= 6) {
              console.log('Reached 6 images limit for this chunk');
              break;
            }
          }
          
          if (images.length >= 6) break;
          
        } catch (error) {
          console.error(`Error scanning tool folder ${toolPath}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`Error scanning project ${projectPath}:`, error.message);
    }
    
    // Store images from this chunk
    if (images.length > 0) {
      console.log(`Storing ${images.length} images from chunk ${chunk}`);
      const { error } = await supabase.from('portfolio_images').upsert(images, {
        onConflict: 'id'
      });
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
    }
    
    // Update metadata
    const { data: allImages } = await supabase.from('portfolio_images').select('project');
    const projects = [...new Set(allImages?.map(img => img.project) || [])];
    
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: allImages?.length || 0,
      projects: JSON.stringify(projects)
    });
    
    // Check if there are more chunks to process
    const hasMoreChunks = (chunk + 1) < projectFolders.length;
    
    console.log(`Chunk ${chunk} complete. Project: ${projectName}, Images: ${images.length}, More chunks: ${hasMoreChunks}`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        chunk: chunk,
        projectName: projectName,
        imagesProcessed: images.length,
        hasMoreChunks: hasMoreChunks,
        nextChunk: hasMoreChunks ? chunk + 1 : null,
        totalProjects: projectFolders.length
      })
    };
    
  } catch (error) {
    console.error('=== CHUNK SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        chunk: event.queryStringParameters?.chunk || '0'
      })
    };
  }
};

// Simplified helper functions for speed
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
    console.error(`Dropbox list failed for ${path}: ${response.status} - ${errorText}`);
    throw new Error(`Dropbox API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.entries || [];
}

function guessTypeFromTool(tool) {
  const toolMap = {
    'Blender': '3D',
    'Figma': 'Design',
    'Photoshop': 'Photo',
    'Illustrator': 'Vector',
    'Glyphs': 'Typography',
    'Photography': 'Photo'
  };
  
  return toolMap[tool] || 'Design';
}

function guessTimeFromDate(dateString) {
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    return `${year}-Q${quarter}`;
  } catch (error) {
    return '2024-Q1'; // Default fallback
  }
}// netlify/functions/sync-dropbox-chunks.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== CHUNKED DROPBOX SYNC START ===');
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get the chunk parameter (which batch of projects to process)
    const chunk = parseInt(event.queryStringParameters?.chunk || '0');
    const chunkSize = 2; // Process 2 projects at a time
    
    console.log(`Processing chunk ${chunk} (${chunkSize} projects per chunk)`);
    
    // Get all project folders first
    const portfolioPath = '/aboutcontact/website/portfolio';
    const allProjects = await listDropboxFolder(dropboxToken, portfolioPath);
    const projectFolders = allProjects.filter(item => item['.tag'] === 'folder');
    
    // Calculate which projects to process in this chunk
    const startIdx = chunk * chunkSize;
    const endIdx = startIdx + chunkSize;
    const projectsToProcess = projectFolders.slice(startIdx, endIdx);
    
    console.log(`Total projects: ${projectFolders.length}, Processing projects ${startIdx}-${endIdx-1}`);
    
    if (projectsToProcess.length === 0) {
      // No more projects to process
      console.log('No more projects to process');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          completed: true,
          chunk: chunk,
          totalProjects: projectFolders.length
        })
      };
    }
    
    const images = [];
    
    // Process this chunk of projects
    for (const project of projectsToProcess) {
      const projectName = project.name;
      const projectPath = project.path_lower;
      console.log(`Scanning project: ${projectName}`);
      
      try {
        const toolFolders = await listDropboxFolder(dropboxToken, projectPath);
        
        for (const tool of toolFolders) {
          if (tool['.tag'] !== 'folder') continue;
          
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            const files = await listDropboxFolder(dropboxToken, toolPath);
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              const extension = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
            });
            
            for (const file of imageFiles) {
              const imageUrl = await getDropboxTemporaryUrl(dropboxToken, file.path_lower);
              
              const imageData = {
                id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
                name: file.name.replace(/\.[^/.]+$/, ''),
                project: projectName,
                tool: toolName,
                type: guessTypeFromTool(toolName),
                time: guessTimeFromDate(file.client_modified),
                aspectratio: 1.33, // Default, will be updated when image loads
                path: file.path_lower,
                size: file.size,
                modified: file.client_modified,
                extension: file.name.split('.').pop().toLowerCase(),
                image_url: imageUrl,
                scanned: new Date().toISOString()
              };
              
              images.push(imageData);
            }
          } catch (error) {
            console.error(`Error scanning tool folder ${toolPath}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Error scanning project ${projectPath}:`, error.message);
      }
    }
    
    // Store images from this chunk
    if (images.length > 0) {
      console.log(`Storing ${images.length} images from chunk ${chunk}`);
      const { error } = await supabase.from('portfolio_images').upsert(images);
      if (error) throw error;
    }
    
    // Update metadata
    const { data: allImages } = await supabase.from('portfolio_images').select('project');
    const projects = [...new Set(allImages?.map(img => img.project) || [])];
    
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: allImages?.length || 0,
      projects: JSON.stringify(projects)
    });
    
    // Check if there are more chunks to process
    const hasMoreChunks = endIdx < projectFolders.length;
    
    console.log(`Chunk ${chunk} complete. Images processed: ${images.length}. More chunks: ${hasMoreChunks}`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        chunk: chunk,
        imagesProcessed: images.length,
        hasMoreChunks: hasMoreChunks,
        nextChunk: hasMoreChunks ? chunk + 1 : null,
        totalProjects: projectFolders.length
      })
    };
    
  } catch (error) {
    console.error('=== CHUNK SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        chunk: event.queryStringParameters?.chunk || '0'
      })
    };
  }
};

// Helper functions (same as your existing ones)
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
    throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
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