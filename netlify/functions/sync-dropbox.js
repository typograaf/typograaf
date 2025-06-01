// netlify/functions/sync-dropbox.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const PORTFOLIO_PATH = '/AboutContact/Website/Portfolio';
const MAX_IMAGES = 50; // Limit to prevent timeout
const TIMEOUT_BUFFER = 8000; // Leave 2 seconds buffer

exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  try {
    console.log('Starting Dropbox sync...');
    
    if (!DROPBOX_ACCESS_TOKEN) {
      throw new Error('DROPBOX_ACCESS_TOKEN environment variable not set');
    }
    
    const portfolioData = await scanPortfolioStructure(startTime);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        images: portfolioData,
        timestamp: new Date().toISOString(),
        count: portfolioData.length,
        message: portfolioData.length >= MAX_IMAGES ? `Limited to ${MAX_IMAGES} images to prevent timeout` : `Found ${portfolioData.length} images`
      })
    };
  } catch (error) {
    console.error('Sync error:', error);
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

async function scanPortfolioStructure(startTime) {
  const portfolioData = [];
  
  try {
    console.log('Scanning portfolio folder:', PORTFOLIO_PATH);
    const projectFolders = await listDropboxFolder(PORTFOLIO_PATH);
    
    for (const projectFolder of projectFolders) {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_BUFFER) {
        console.log('Approaching timeout, stopping scan');
        break;
      }
      
      if (projectFolder['.tag'] === 'folder') {
        const projectName = projectFolder.name;
        const projectPath = `${PORTFOLIO_PATH}/${projectName}`;
        
        console.log('Processing project:', projectName);
        
        // Get tool folders within project
        const toolFolders = await listDropboxFolder(projectPath);
        
        for (const toolFolder of toolFolders) {
          // Check timeout and image limit
          if (Date.now() - startTime > TIMEOUT_BUFFER || portfolioData.length >= MAX_IMAGES) {
            console.log('Stopping due to timeout or image limit');
            break;
          }
          
          if (toolFolder['.tag'] === 'folder') {
            const toolName = toolFolder.name;
            const toolPath = `${projectPath}/${toolName}`;
            
            console.log('Processing tool folder:', `${projectName}/${toolName}`);
            
            // Get images in tool folder
            const files = await listDropboxFolder(toolPath);
            
            for (const file of files) {
              // Check limits
              if (Date.now() - startTime > TIMEOUT_BUFFER || portfolioData.length >= MAX_IMAGES) {
                break;
              }
              
              if (file['.tag'] === 'file' && isImageFile(file.name)) {
                console.log('Processing image:', file.name);
                
                try {
                  // Skip getting image URL for now to speed up - just store metadata
                  const imageData = {
                    name: file.name.replace(/\.[^/.]+$/, ""),
                    project: projectName,
                    tool: toolName,
                    type: guessTypeFromName(file.name),
                    time: extractTimeFromFile(file),
                    aspectRatio: await guessAspectRatio(file.name),
                    path: file.path_lower,
                    size: file.size,
                    modified: file.server_modified,
                    // We'll generate imageUrl on demand later
                    needsUrl: true
                  };
                  
                  portfolioData.push(imageData);
                } catch (imageError) {
                  console.error('Error processing image:', file.name, imageError.message);
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error scanning portfolio structure:', error);
    throw error;
  }
  
  console.log(`Found ${portfolioData.length} images total`);
  return portfolioData;
}

async function listDropboxFolder(path) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      path: path,
      recursive: false
    });
    
    const options = {
      hostname: 'api.dropboxapi.com',
      port: 443,
      path: '/2/files/list_folder',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (res.statusCode === 200) {
            resolve(jsonData.entries || []);
          } else {
            reject(new Error(`Dropbox API error: ${res.statusCode} - ${jsonData.error_summary || data}`));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse Dropbox response: ${parseError.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

function isImageFile(filename) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return imageExtensions.includes(ext);
}

function guessTypeFromName(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('logo') || lower.includes('brand') || lower.includes('identity')) return 'Brand';
  if (lower.includes('type') || lower.includes('font') || lower.includes('text')) return 'Typography';
  if (lower.includes('3d') || lower.includes('render') || lower.includes('model')) return '3D';
  if (lower.includes('photo') || lower.includes('img_') || lower.includes('dsc_')) return 'Photography';
  if (lower.includes('web') || lower.includes('site') || lower.includes('ui')) return 'Web';
  if (lower.includes('pack') || lower.includes('box') || lower.includes('container')) return 'Packaging';
  return 'Design';
}

async function guessAspectRatio(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('portrait') || lower.includes('vertical')) return 3/4;
  if (lower.includes('square') || lower.includes('1x1')) return 1;
  if (lower.includes('wide') || lower.includes('banner')) return 16/9;
  if (lower.includes('screen') || lower.includes('desktop')) return 16/10;
  return 4/3;
}

function extractTimeFromFile(file) {
  try {
    const date = new Date(file.server_modified || file.client_modified);
    const year = date.getFullYear();
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    return `${year}-Q${quarter}`;
  } catch (error) {
    const now = new Date();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    return `${now.getFullYear()}-Q${quarter}`;
  }
}