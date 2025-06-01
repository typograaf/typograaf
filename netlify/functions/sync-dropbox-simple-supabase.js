// netlify/functions/sync-dropbox-simple-supabase.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORTFOLIO_PATH = '/AboutContact/Website/Portfolio';

exports.handler = async (event, context) => {
  try {
    console.log('Simple Supabase sync starting...');
    
    const queryParams = event.queryStringParameters || {};
    const forceRefresh = queryParams.refresh === 'true';
    const requestedBatch = parseInt(queryParams.batch) || 0;
    
    // Check if we need to refresh
    if (forceRefresh) {
      console.log('Force refresh requested...');
      await performFullSync();
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
    console.error('Simple sync error:', error);
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

async function performFullSync() {
  try {
    console.log('Starting full Dropbox scan...');
    
    // First, clear existing data
    console.log('Clearing existing data...');
    const deleteResponse = await supabaseRequest('DELETE', '/rest/v1/portfolio_images');
    console.log('Delete response status:', deleteResponse.status);
    
    // Scan Dropbox
    const portfolioData = await scanDropboxPortfolio();
    console.log(`Scanned ${portfolioData.length} images from Dropbox`);
    
    if (portfolioData.length === 0) {
      throw new Error('No images found in Dropbox scan');
    }
    
    // Insert data in smaller batches to avoid timeouts
    console.log('Inserting data into database...');
    const batchSize = 10; // Smaller batches
    
    for (let i = 0; i < portfolioData.length; i += batchSize) {
      const batch = portfolioData.slice(i, i + batchSize);
      console.log(`Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(portfolioData.length/batchSize)}...`);
      
      const insertResponse = await supabaseRequest('POST', '/rest/v1/portfolio_images', batch);
      console.log(`Batch ${Math.floor(i/batchSize) + 1} status:`, insertResponse.status);
      
      if (insertResponse.status !== 201) {
        const errorText = await insertResponse.text();
        console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, errorText);
        // Continue with other batches instead of failing completely
      }
    }
    
    // Update metadata
    console.log('Updating metadata...');
    await supabaseRequest('DELETE', '/rest/v1/portfolio_meta');
    
    const metaData = [{
      last_sync: new Date().toISOString(),
      total_images: portfolioData.length,
      projects: [...new Set(portfolioData.map(img => img.project))].join(',')
    }];
    
    const metaResponse = await supabaseRequest('POST', '/rest/v1/portfolio_meta', metaData);
    console.log('Meta update status:', metaResponse.status);
    
    console.log('Full sync complete!');
    
  } catch (error) {
    console.error('Full sync error:', error);
    throw error;
  }
}

async function getPortfolioFromDB(requestedBatch = 0) {
  try {
    const BATCH_SIZE = 20;
    const offset = requestedBatch * BATCH_SIZE;
    
    // Get total count by querying all IDs
    const allResponse = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=id');
    let totalImages = 0;
    
    if (allResponse.status === 200) {
      const allData = await allResponse.json();
      totalImages = allData.length;
    }
    
    console.log(`Total images in DB: ${totalImages}`);
    
    // If no images, return empty result
    if (totalImages === 0) {
      return {
        success: true,
        images: [],
        batch: {
          current: 0,
          total: 0,
          hasMore: false,
          nextBatch: null
        },
        stats: {
          totalImages: 0,
          batchSize: BATCH_SIZE,
          cached: true,
          source: 'supabase'
        },
        timestamp: new Date().toISOString()
      };
    }
    
    // Get batch of images
    const response = await supabaseRequest('GET', 
      `/rest/v1/portfolio_images?select=*&order=project,tool,name&limit=${BATCH_SIZE}&offset=${offset}`
    );
    
    if (response.status !== 200) {
      const errorText = await response.text();
      console.error('Failed to fetch images:', errorText);
      throw new Error('Failed to fetch from database');
    }
    
    const images = await response.json();
    console.log(`Fetched ${images.length} images for batch ${requestedBatch}`);
    
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

async function scanDropboxPortfolio() {
  const portfolioData = [];
  
  try {
    console.log('Listing project folders...');
    const projectFolders = await listDropboxFolder(PORTFOLIO_PATH);
    console.log(`Found ${projectFolders.length} project folders`);
    
    // Process each project folder
    for (const projectFolder of projectFolders) {
      if (projectFolder['.tag'] === 'folder') {
        const projectName = projectFolder.name;
        const projectPath = `${PORTFOLIO_PATH}/${projectName}`;
        
        console.log(`Scanning project: ${projectName}`);
        await scanProjectRecursively(projectPath, projectName, portfolioData);
      }
    }
    
    console.log(`Found ${portfolioData.length} total images`);
    
    // Get image URLs for all images
    console.log('Fetching image URLs...');
    await fetchImageUrlsForAll(portfolioData);
    
    return portfolioData;
    
  } catch (error) {
    console.error('Error scanning Dropbox portfolio:', error);
    throw error;
  }
}

async function fetchImageUrlsForAll(portfolioData) {
  const batchSize = 5;
  
  for (let i = 0; i < portfolioData.length; i += batchSize) {
    const batch = portfolioData.slice(i, i + batchSize);
    console.log(`Fetching URLs for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(portfolioData.length/batchSize)}`);
    
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

async function scanProjectRecursively(folderPath, projectName, portfolioData, toolName = 'Mixed') {
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
          aspectratio: guessAspectRatio(item.name),
          path: item.path_lower,
          size: item.size,
          modified: item.server_modified,
          extension: item.name.toLowerCase().substring(item.name.lastIndexOf('.')),
          image_url: null, // Will be filled later
          scanned: new Date().toISOString()
        };
        
        portfolioData.push(imageData);
      } else if (item['.tag'] === 'folder') {
        const subFolderPath = `${folderPath}/${item.name}`;
        await scanProjectRecursively(subFolderPath, projectName, portfolioData, item.name);
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
        res.text = () => responseData;
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

// Include helper functions from original code
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