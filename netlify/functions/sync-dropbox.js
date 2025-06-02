// netlify/functions/sync-dropbox.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DROPBOX SYNC START ===');
  
  try {
    // Environment variables check
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
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
    
    // Test Dropbox token first
    console.log('Testing Dropbox access...');
    await testDropboxAccess(dropboxToken);
    console.log('Dropbox access OK');
    
    // Scan Dropbox folder
    const portfolioPath = '/AboutContact/Website/Portfolio';
    console.log('Scanning portfolio path:', portfolioPath);
    
    const images = await scanDropboxPortfolio(dropboxToken, portfolioPath);
    
    console.log(`Found ${images.length} images to sync`);
    
    if (images.length > 0) {
      // Clear existing data
      console.log('Clearing existing portfolio data...');
      await supabase.from('portfolio_images').delete().neq('id', '');
      
      // Insert new data
      console.log('Inserting new portfolio data...');
      const { error } = await supabase.from('portfolio_images').insert(images);
      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }
    }
    
    // Update metadata
    const projects = [...new Set(images.map(img => img.project))];
    console.log('Projects found:', projects);
    
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: images.length,
      projects: JSON.stringify(projects)
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

async function testDropboxAccess(token) {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Dropbox test failed:', response.status, errorText);
    throw new Error(`Dropbox authentication failed: ${response.status} - Check your DROPBOX_ACCESS_TOKEN`);
  }
  
  const data = await response.json();
  console.log('Dropbox user:', data.name?.display_name || 'Unknown');
  return data;
}

async function scanDropboxPortfolio(token, basePath) {
  const images = [];
  
  try {
    console.log('Listing base portfolio folder...');
    // Get project folders
    const projectFolders = await listDropboxFolder(token, basePath);
    console.log(`Found ${projectFolders.length} items in portfolio folder`);
    
    for (const project of projectFolders) {
      if (project['.tag'] !== 'folder') {
        console.log(`Skipping non-folder: ${project.name}`);
        continue;
      }
      
      const projectName = project.name;
      const projectPath = `${basePath}/${projectName}`;
      console.log(`Scanning project: ${projectName}`);
      
      try {
        // Get tool subfolders
        const toolFolders = await listDropboxFolder(token, projectPath);
        console.log(`Found ${toolFolders.length} tool folders in ${projectName}`);
        
        for (const tool of toolFolders) {
          if (tool['.tag'] !== 'folder') {
            console.log(`Skipping non-folder in ${projectName}: ${tool.name}`);
            continue;
          }
          
          const toolName = tool.name;
          const toolPath = `${projectPath}/${toolName}`;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            // Get images in tool folder
            const files = await listDropboxFolder(token, toolPath);
            console.log(`Found ${files.length} files in ${projectName}/${toolName}`);
            
            for (const file of files) {
              if (file['.tag'] !== 'file') continue;
              
              const extension = file.name.split('.').pop().toLowerCase();
              if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension)) {
                console.log(`Skipping non-image: ${file.name}`);
                continue;
              }
              
              console.log(`Processing image: ${file.name}`);
              
              // Generate temporary URL
              const imageUrl = await getDropboxTemporaryUrl(token, file.path_lower);
              
              // Use a default aspect ratio for now (can be improved later)
              const aspectRatio = 1.33;
              
              const imageData = {
                id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
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
              console.log(`Added image: ${imageData.name} (${projectName}/${toolName})`);
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
    body: JSON.stringify({ path })
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