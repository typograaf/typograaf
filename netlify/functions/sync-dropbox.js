// netlify/functions/sync-dropbox.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DROPBOX SYNC START ===');
  
  try {
    // Environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Scan Dropbox folder
    const portfolioPath = '/AboutContact/Website/Portfolio';
    const images = await scanDropboxPortfolio(dropboxToken, portfolioPath);
    
    console.log(`Found ${images.length} images to sync`);
    
    // Clear existing data
    await supabase.from('portfolio_images').delete().neq('id', '');
    
    // Insert new data
    if (images.length > 0) {
      const { error } = await supabase.from('portfolio_images').insert(images);
      if (error) throw error;
    }
    
    // Update metadata
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: images.length,
      projects: JSON.stringify([...new Set(images.map(img => img.project))])
    });
    
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
        projects: [...new Set(images.map(img => img.project))],
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
        error: error.message
      })
    };
  }
};

async function scanDropboxPortfolio(token, basePath) {
  const images = [];
  
  // Get project folders
  const projectFolders = await listDropboxFolder(token, basePath);
  
  for (const project of projectFolders) {
    if (!project.tag === 'folder') continue;
    
    const projectName = project.name;
    const projectPath = `${basePath}/${projectName}`;
    
    // Get tool subfolders
    const toolFolders = await listDropboxFolder(token, projectPath);
    
    for (const tool of toolFolders) {
      if (!tool.tag === 'folder') continue;
      
      const toolName = tool.name;
      const toolPath = `${projectPath}/${toolName}`;
      
      // Get images in tool folder
      const files = await listDropboxFolder(token, toolPath);
      
      for (const file of files) {
        if (file.tag !== 'file') continue;
        
        const extension = file.name.split('.').pop().toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) continue;
        
        // Generate temporary URL
        const imageUrl = await getDropboxTemporaryUrl(token, file.path_lower);
        
        // Extract metadata
        const aspectRatio = await getImageAspectRatio(imageUrl);
        
        const imageData = {
          id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-]/g, '-'),
          name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
          project: projectName,
          tool: toolName,
          type: guessTypeFromTool(toolName),
          time: guessTimeFromDate(file.client_modified),
          aspectratio: aspectRatio,
          path: file.path_lower,
          size: file.size,
          modified: file.client_modified,
          extension: extension,
          image_url: imageUrl,
          scanned: new Date().toISOString()
        };
        
        images.push(imageData);
      }
    }
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
    body: JSON.stringify({ path })
  });
  
  if (!response.ok) {
    throw new Error(`Dropbox API error: ${response.status}`);
  }
  
  const data = await response.json();
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
    console.error(`Failed to get temporary URL for ${path}`);
    return null;
  }
  
  const data = await response.json();
  return data.link;
}

async function getImageAspectRatio(imageUrl) {
  if (!imageUrl) return 1;
  
  try {
    // This is a simplified version - in production you might want to use a proper image analysis library
    return 1.33; // Default aspect ratio, can be improved
  } catch (error) {
    return 1;
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
    'Capture One': 'Photo'
  };
  
  return toolMap[tool] || 'Design';
}

function guessTimeFromDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const quarter = Math.ceil((date.getMonth() + 1) / 3);
  
  return `${year}-Q${quarter}`;
}