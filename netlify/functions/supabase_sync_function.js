// netlify/functions/sync-dropbox-supabase.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORTFOLIO_PATH = '/AboutContact/Website/Portfolio';

exports.handler = async (event, context) => {
  try {
    console.log('Supabase sync request received');
    
    if (!DROPBOX_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing environment variables');
    }
    
    const queryParams = event.queryStringParameters || {};
    const forceRefresh = queryParams.refresh === 'true';
    const requestedBatch = parseInt(queryParams.batch) || 0;
    
    // Check if we should refresh
    const shouldRefresh = forceRefresh || await shouldRefreshCache();
    
    if (shouldRefresh) {
      console.log('Refreshing portfolio data...');
      await refreshPortfolioData();
    }
    
    // Get data from database
    const portfolioData = await getPortfolioFromDB(requestedBatch);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify(portfolioData)
    };
    
  } catch (error) {
    console.error('Supabase sync error:', error);
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

async function shouldRefreshCache() {
  try {
    const response = await supabaseRequest('GET', '/rest/v1/portfolio_meta?select=last_sync&order=last_sync.desc&limit=1');
    const data = await response.json();
    
    if (data.length === 0) return true; // No data, need to sync
    
    const lastSync = new Date(data[0].last_sync);
    const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceSync > 2; // Refresh every 2 hours
  } catch (error) {
    console.error('Error checking cache status:', error);
    return true; // Refresh on error
  }
}

async function getPortfolioFromDB(requestedBatch = 0) {
  try {
    const BATCH_SIZE = 20;
    const offset = requestedBatch * BATCH_SIZE;
    
    // Get total count
    const countResponse = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=count');
    const totalImages = countResponse.status === 200 ? (await countResponse.json())[0]?.count || 0 : 0;
    
    // Get batch of images
    const response = await supabaseRequest('GET', 
      `/rest/v1/portfolio_images?select=*&order=project,tool,name&limit=${BATCH_SIZE}&offset=${offset}`
    );
    
    if (response.status !== 200) {
      throw new Error('Failed to fetch from database');
    }
    
    const images = await response.json();
    
    const totalBatches = Math.ceil(totalImages / BATCH_SIZE);
    const hasMore = requestedBatch < totalBatches - 1;
    
    return {
      success: true,
      images: images,
      batch: {
        current: requestedBatch,
        total: totalBatches,
        hasMore: hasMore,
        nextBatch: hasMore ? requestedBatch + 1 : null
      },
      stats: {
        totalImages: totalImages,
        batchSize: BATCH_SIZE,
        cached: true,
        source: 'supabase'
      },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error getting portfolio from DB:', error);
    throw error;
  }
}

async function refreshPortfolioData() {
  try {
    console.log('Starting Dropbox scan...');
    const portfolioData = await scanDropboxPortfolio();
    
    console.log(`Scanned ${portfolioData.length} images, updating database...`);
    
    // Clear existing data
    await supabaseRequest('DELETE', '/rest/v1/portfolio_images');
    
    // Insert new data in batches
    const batchSize = 100;
    for (let i = 0; i < portfolioData.length; i += batchSize) {
      const batch = portfolioData.slice(i, i + batchSize);
      await supabaseRequest('POST', '/rest/v1/portfolio_images', batch);
      console.log(`Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(portfolioData.length/batchSize)}`);
    }
    
    // Update metadata
    await supabaseRequest('DELETE', '/rest/v1/portfolio_meta');
    await supabaseRequest('POST', '/rest/v1/portfolio_meta', [{
      last_sync: new Date().toISOString(),
      total_images: portfolioData.length,
      projects: [...new Set(portfolioData.map(img => img.project))].join(',')
    }]);
    
    console.log('Database update complete');
    
  } catch (error) {
    console.error('Error refreshing portfolio data:', error);
    throw error;
  }
}

async function scanDropboxPortfolio() {
  const portfolioData = [];
  
  try {
    const projectFolders = await listDropboxFolder(PORTFOLIO_PATH);
    
    // Scan all projects in parallel (faster)
    const projectPromises = projectFolders
      .filter(folder => folder['.tag'] === 'folder')
      .map(async (projectFolder) => {
        const projectName = projectFolder.name;
        const projectPath = `${PORTFOLIO_PATH}/${projectName}`;
        
        console.log(`Scanning project: ${projectName}`);
        const projectImages = [];
        await scanProjectRecursively(projectPath, projectName, projectImages);
        
        // Get image URLs for this project in parallel
        await fetchImageUrlsForProject(projectImages);
        
        return projectImages;
      });
    
    const projectResults = await Promise.all(projectPromises);
    
    // Flatten results
    projectResults.forEach(projectImages => {
      portfolioData.push(...projectImages);
    });
    
    return portfolioData;
    
  } catch (error) {
    console.error('Error scanning Dropbox portfolio:', error);
    throw error;
  }
}

async function fetchImageUrlsForProject(projectImages) {
  const batchSize = 5;
  
  for (let i = 0; i < projectImages.length; i += batchSize) {
    const batch = projectImages.slice(i, i + batchSize);
    
    const promises = batch.map(async (item) => {
      try {
        const imageUrl = await getDropboxImageUrl(item.path);
        if (imageUrl) {
          item.image_url = imageUrl;
          item.url_fetched = new Date().toISOString();
        }
      } catch (error) {
        console.error(`Failed to get URL for ${item.name}:`, error.message);
        item.image_url = null;
      }
    });
    
    await Promise.all(promises);
  }
}

async function scanProjectRecursively(folderPath, projectName, projectImages, toolName = 'Mixed') {
  try {
    const contents = await listDropboxFolder(folderPath);
    
    for (const item of contents) {
      if (item['.tag'] === 'file' && isImageFile(item.name)) {
        const imageData = {
          id: `${projectName}-${toolName}-${item.name}`.replace(/[^a-zA-Z0-9-]/g, '-'),
          name: item.name.replace(/\.[^/.]+$/, ""),
          project: projectName,
          tool: toolName,
          type: guessTypeFromName(item.name),
          time: extractTimeFromFile(item),
          aspectRatio: guessAspectRatio(item.name),
          path: item.path_lower,
          size: item.size,
          modified: item.server_modified,
          extension: item.name.toLowerCase().substring(item.name.lastIndexOf('.')),
          image_url: null, // Will be filled later
          scanned: new Date().toISOString()
        };
        
        projectImages.push(imageData);
      } else if (item['.tag'] === 'folder') {
        const subFolderPath = `${folderPath}/${item.name}`;
        await scanProjectRecursively(subFolderPath, projectName, projectImages, item.name);
      }
    }
  } catch (error) {
    console.error(`Error scanning folder ${folderPath}:`, error.message);
  }
}

async function supabaseRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        res.json = () => {
          try {
            return JSON.parse(responseData);
          } catch (e) {
            return null;
          }
        };
        resolve(res);
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Supabase request error: ${error.message}`));
    });
    
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Include all helper functions (listDropboxFolder, getDropboxImageUrl, etc.)
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

async function getDropboxImageUrl(path) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      path: path
    });
    
    const options = {
      hostname: 'api.dropboxapi.com',
      port: 443,
      path: '/2/files/get_temporary_link',
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
            resolve(jsonData.link);
          } else {
            resolve(null);
          }
        } catch (parseError) {
          resolve(null);
        }
      });
    });
    
    req.on('error', (error) => {
      resolve(null);
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