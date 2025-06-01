// netlify/functions/sync-dropbox.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const PORTFOLIO_PATH = '/AboutContact/Website/Portfolio';
const BATCH_SIZE = 20; // Process 20 images per request
const TIMEOUT_BUFFER = 8000; // 8 seconds max processing

// In-memory cache (will reset on cold starts)
let portfolioCache = null;
let lastSyncTime = null;
let isProcessing = false;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  try {
    console.log('Dropbox sync request received');
    
    if (!DROPBOX_ACCESS_TOKEN) {
      throw new Error('DROPBOX_ACCESS_TOKEN environment variable not set');
    }
    
    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const requestedBatch = parseInt(queryParams.batch) || 0;
    const forceRefresh = queryParams.refresh === 'true';
    
    // If we have cached data and it's recent (less than 1 hour old), use it
    const cacheMaxAge = 60 * 60 * 1000; // 1 hour
    const isCacheValid = portfolioCache && lastSyncTime && 
                        (Date.now() - lastSyncTime < cacheMaxAge) && !forceRefresh;
    
    if (isCacheValid) {
      console.log('Using cached portfolio data');
      return returnBatchedResponse(portfolioCache, requestedBatch, startTime);
    }
    
    // If already processing, return current progress
    if (isProcessing) {
      return {
        statusCode: 202, // Accepted, still processing
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          message: 'Still processing portfolio. Please try again in a few seconds.',
          processing: true,
          timestamp: new Date().toISOString()
        })
      };
    }
    
    // Start fresh scan
    isProcessing = true;
    console.log('Starting fresh portfolio scan...');
    
    const portfolioData = await scanPortfolioStructure(startTime);
    
    // Cache the results
    portfolioCache = portfolioData;
    lastSyncTime = Date.now();
    isProcessing = false;
    
    return returnBatchedResponse(portfolioData, requestedBatch, startTime);
    
  } catch (error) {
    isProcessing = false;
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

function returnBatchedResponse(portfolioData, requestedBatch, startTime) {
  const totalImages = portfolioData.length;
  const startIndex = requestedBatch * BATCH_SIZE;
  const endIndex = Math.min(startIndex + BATCH_SIZE, totalImages);
  const batchData = portfolioData.slice(startIndex, endIndex);
  
  const totalBatches = Math.ceil(totalImages / BATCH_SIZE);
  const hasMore = requestedBatch < totalBatches - 1;
  
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
      images: batchData,
      batch: {
        current: requestedBatch,
        total: totalBatches,
        hasMore: hasMore,
        nextBatch: hasMore ? requestedBatch + 1 : null
      },
      stats: {
        totalImages: totalImages,
        batchSize: BATCH_SIZE,
        processingTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString(),
      cached: lastSyncTime ? new Date(lastSyncTime).toISOString() : null
    })
  };
}

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
        
        // Process this project folder recursively
        await processProjectFolder(projectPath, projectName, portfolioData, startTime);
      }
    }
  } catch (error) {
    console.error('Error scanning portfolio structure:', error);
    throw error;
  }
  
  console.log(`Found ${portfolioData.length} images total`);
  return portfolioData;
}

async function processProjectFolder(projectPath, projectName, portfolioData, startTime, toolName = 'Mixed') {
  try {
    const contents = await listDropboxFolder(projectPath);
    
    for (const item of contents) {
      if (Date.now() - startTime > TIMEOUT_BUFFER) {
        console.log('Timeout reached in processProjectFolder');
        break;
      }
      
      if (item['.tag'] === 'file' && isImageFile(item.name)) {
        // Found an image file
        await processImageFile(item, projectName, toolName, portfolioData);
      } else if (item['.tag'] === 'folder') {
        // Found a subfolder - recurse into it
        const subFolderPath = `${projectPath}/${item.name}`;
        console.log('Processing subfolder:', `${projectName}/${item.name}`);
        await processProjectFolder(subFolderPath, projectName, portfolioData, startTime, item.name);
      }
    }
  } catch (error) {
    console.error(`Error processing project folder ${projectPath}:`, error.message);
  }
}

async function processImageFile(file, projectName, toolName, portfolioData) {
  try {
    const imageData = {
      id: `${projectName}-${toolName}-${file.name}`.replace(/[^a-zA-Z0-9-]/g, '-'),
      name: file.name.replace(/\.[^/.]+$/, ""),
      project: projectName,
      tool: toolName,
      type: guessTypeFromName(file.name),
      time: extractTimeFromFile(file),
      aspectRatio: guessAspectRatio(file.name),
      path: file.path_lower,
      size: file.size,
      modified: file.server_modified,
      extension: file.name.toLowerCase().substring(file.name.lastIndexOf('.')),
      urlEndpoint: `/.netlify/functions/get-image?path=${encodeURIComponent(file.path_lower)}`
    };
    
    portfolioData.push(imageData);
    console.log(`Added image: ${projectName}/${toolName}/${file.name}`);
  } catch (imageError) {
    console.error('Error processing image:', file.name, imageError.message);
  }
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
  const imageExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg', 
    '.avif', '.heic', '.heif', '.ico', '.jfif', '.pjpeg', '.pjp'
  ];
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

function guessAspectRatio(filename) {
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