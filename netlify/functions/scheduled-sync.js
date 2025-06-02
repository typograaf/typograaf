// netlify/functions/scheduled-sync.js
const { createClient } = require('@supabase/supabase-js');
const { schedule } = require('@netlify/functions');

const handler = async (event, context) => {
  console.log('=== SCHEDULED SYNC START ===');
  
  try {
    // Environment variables check
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!supabaseUrl || !supabaseKey || !dropboxToken) {
      throw new Error('Missing required environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Check last sync time to avoid too frequent syncs
    const { data: meta } = await supabase
      .from('portfolio_meta')
      .select('last_sync')
      .single();
    
    const lastSync = meta?.last_sync ? new Date(meta.last_sync) : null;
    const now = new Date();
    const hoursSinceLastSync = lastSync ? (now - lastSync) / (1000 * 60 * 60) : 24;
    
    // Only sync if it's been more than 4 hours (or never synced)
    if (hoursSinceLastSync < 4) {
      console.log(`Last sync was ${hoursSinceLastSync.toFixed(1)} hours ago, skipping`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Sync skipped - too recent',
          lastSync: lastSync
        })
      };
    }
    
    console.log('Starting full portfolio sync...');
    
    // Scan all Dropbox portfolio folders without limits
    const portfolioPath = '/aboutcontact/website/portfolio';
    const images = await scanDropboxPortfolioFull(dropboxToken, portfolioPath);
    
    console.log(`Found ${images.length} total images`);
    
    if (images.length > 0) {
      // Clear and replace all data
      console.log('Clearing existing portfolio data...');
      await supabase.from('portfolio_images').delete().neq('id', '');
      
      // Insert in batches
      console.log('Inserting new portfolio data...');
      const batchSize = 50;
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        const { error } = await supabase.from('portfolio_images').insert(batch);
        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }
        console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(images.length/batchSize)}`);
      }
    }
    
    // Update metadata
    const projects = [...new Set(images.map(img => img.project))];
    await supabase.from('portfolio_meta').upsert({
      last_sync: new Date().toISOString(),
      total_images: images.length,
      projects: JSON.stringify(projects)
    });
    
    console.log('=== SCHEDULED SYNC COMPLETE ===');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        synced: images.length,
        projects: projects.length,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== SCHEDULED SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Schedule to run every 6 hours
exports.handler = schedule("0 */6 * * *", handler);

async function scanDropboxPortfolioFull(token, basePath) {
  const images = [];
  
  try {
    console.log('Scanning all portfolio projects...');
    const projectFolders = await listDropboxFolder(token, basePath);
    
    const projects = projectFolders.filter(item => item['.tag'] === 'folder');
    console.log(`Found ${projects.length} projects to scan`);
    
    for (const project of projects) {
      const projectName = project.name;
      const projectPath = project.path_lower;
      console.log(`Scanning project: ${projectName}`);
      
      try {
        const toolFolders = await listDropboxFolder(token, projectPath);
        
        for (const tool of toolFolders) {
          if (tool['.tag'] !== 'folder') continue;
          
          const toolName = tool.name;
          const toolPath = tool.path_lower;
          console.log(`Scanning tool folder: ${projectName}/${toolName}`);
          
          try {
            const files = await listDropboxFolder(token, toolPath);
            
            const imageFiles = files.filter(file => {
              if (file['.tag'] !== 'file') return false;
              const extension = file.name.split('.').pop().toLowerCase();
              return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(extension);
            });
            
            for (const file of imageFiles) {
              const imageUrl = await getDropboxTemporaryUrl(token, file.path_lower);
              
              const imageData = {
                id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-._]/g, '-'),
                name: file.name.replace(/\.[^/.]+$/, ''),
                project: projectName,
                tool: toolName,
                type: guessTypeFromTool(toolName),
                time: guessTimeFromDate(file.client_modified),
                aspectratio: 1.33, // Default, could be improved with image analysis
                path: file.path_lower,
                size: file.size,
                modified: file.client_modified,
                extension: file.name.split('.').pop().toLowerCase(),
                image_url: imageUrl,
                scanned: new Date().toISOString()
              };
              
              images.push(imageData);
              console.log(`Added: ${imageData.name} (${projectName}/${toolName})`);
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
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.link;
  } catch (error) {
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