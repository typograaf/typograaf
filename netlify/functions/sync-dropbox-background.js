// netlify/functions/sync-dropbox-background.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORTFOLIO_PATH = '/AboutContact/Website/Portfolio';

exports.handler = async (event, context) => {
  // Set timeout to 8 seconds to avoid the 10-second limit
  const startTime = Date.now();
  const TIMEOUT_MS = 8000;
  
  try {
    console.log('Background sync starting...');
    
    const queryParams = event.queryStringParameters || {};
    const forceRefresh = queryParams.refresh === 'true';
    const requestedBatch = parseInt(queryParams.batch) || 0;
    const syncProject = queryParams.project || null; // Sync specific project only
    
    // If requesting data (not refresh), return from database
    if (!forceRefresh) {
      return await getPortfolioFromDB(requestedBatch);
    }
    
    // If refresh requested, do background sync
    if (syncProject) {
      // Sync specific project only
      await syncSingleProject(syncProject, startTime, TIMEOUT_MS);
    } else {
      // Start background sync process
      await startBackgroundSync(startTime, TIMEOUT_MS);
    }
    
    // Return current state
    return await getPortfolioFromDB(0);
    
  } catch (error) {
    console.error('Background sync error:', error);
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

async function startBackgroundSync(startTime, timeoutMs) {
  try {
    console.log('Starting background sync...');
    
    // Get list of projects
    const projectFolders = await listDropboxFolder(PORTFOLIO_PATH);
    const projects = projectFolders
      .filter(folder => folder['.tag'] === 'folder')
      .map(folder => folder.name);
    
    console.log(`Found ${projects.length} projects:`, projects);
    
    // Process projects one by one until timeout
    let processedProjects = 0;
    
    for (const projectName of projects) {
      if (Date.now() - startTime > timeoutMs - 1000) {
        console.log(`Timeout approaching, stopping at project ${processedProjects + 1}/${projects.length}`);
        break;
      }
      
      try {
        await syncSingleProject(projectName, startTime, timeoutMs);
        processedProjects++;
        console.log(`Completed project ${processedProjects}/${projects.length}: ${projectName}`);
      } catch (projectError) {
        console.error(`Failed to sync project ${projectName}:`, projectError.message);
        // Continue with next project
      }
    }
    
    // Update sync status
    await updateSyncMeta({
      last_sync: new Date().toISOString(),
      projects_synced: processedProjects,
      total_projects: projects.length,
      status: processedProjects === projects.length ? 'complete' : 'partial'
    });
    
    console.log(`Background sync completed: ${processedProjects}/${projects.length} projects`);
    
  } catch (error) {
    console.error('Background sync error:', error);
    throw error;
  }
}

async function syncSingleProject(projectName, startTime, timeoutMs) {
  try {
    console.log(`Syncing project: ${projectName}`);
    
    const projectPath = `${PORTFOLIO_PATH}/${projectName}`;
    const projectImages = [];
    
    // Scan project folder
    await scanProjectRecursively(projectPath, projectName, projectImages);
    console.log(`Found ${projectImages.length} images in ${projectName}`);
    
    if (projectImages.length === 0) return;
    
    // Remove existing images for this project
    const deleteResponse = await supabaseRequest('DELETE', `/rest/v1/portfolio_images?project=eq.${encodeURIComponent(projectName)}`);
    console.log(`Deleted existing ${projectName} images, status:`, deleteResponse.status);
    
    // Only proceed if we have new images to add
    if (projectImages.length === 0) {
      console.log(`No images found for ${projectName}, skipping`);
      return;
    }
    
    // Get image URLs in batches (this is the slow part)
    const urlBatchSize = 3; // Very small batches for URLs
    for (let i = 0; i < projectImages.length; i += urlBatchSize) {
      if (Date.now() - startTime > timeoutMs - 1000) {
        console.log(`Timeout approaching, stopping URL fetch at ${i}/${projectImages.length}`);
        break;
      }
      
      const batch = projectImages.slice(i, i + urlBatchSize);
      await fetchImageUrlsForBatch(batch);
      console.log(`Got URLs for ${Math.min(i + urlBatchSize, projectImages.length)}/${projectImages.length} images`);
    }
    
    // Insert images in small batches
    const insertBatchSize = 5;
    for (let i = 0; i < projectImages.length; i += insertBatchSize) {
      const batch = projectImages.slice(i, i + insertBatchSize);
      
      try {
        const insertResponse = await supabaseRequest('POST', '/rest/v1/portfolio_images', batch);
        const responseText = await insertResponse.text();
        
        console.log(`Insert batch ${Math.floor(i/insertBatchSize) + 1} status: ${insertResponse.status}`);
        
        if (insertResponse.status !== 201) {
          console.error(`Insert batch failed (${insertResponse.status}):`, responseText);
          
          // Try inserting one by one to identify problem records
          console.log('Trying individual inserts...');
          for (const item of batch) {
            try {
              const singleResponse = await supabaseRequest('POST', '/rest/v1/portfolio_images', [item]);
              if (singleResponse.status !== 201) {
                const singleText = await singleResponse.text();
                console.error(`Failed to insert ${item.name}:`, singleText);
              } else {
                console.log(`✓ Inserted ${item.name}`);
              }
            } catch (singleError) {
              console.error(`Error inserting ${item.name}:`, singleError.message);
            }
          }
        } else {
          console.log(`✓ Successfully inserted batch of ${batch.length} images`);
        }
      } catch (insertError) {
        console.error(`Insert batch error:`, insertError.message);
      }
    }
    
    console.log(`Successfully synced ${projectImages.length} images for ${projectName}`);
    
  } catch (error) {
    console.error(`Error syncing project ${projectName}:`, error);
    throw error;
  }
}

async function fetchImageUrlsForBatch(batch) {
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

async function getPortfolioFromDB(requestedBatch = 0) {
  try {
    const BATCH_SIZE = 20;
    const offset = requestedBatch * BATCH_SIZE;
    
    // Get batch of images first
    const response = await supabaseRequest('GET', 
      `/rest/v1/portfolio_images?select=*&order=project,tool,name&limit=${BATCH_SIZE}&offset=${offset}`
    );
    
    if (response.status !== 200) {
      throw new Error('Failed to fetch from database');
    }
    
    const images = await response.json();
    console.log(`Fetched ${images.length} images for batch ${requestedBatch}`);
    
    // Get total count using a simpler method
    const countResponse = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=id');
    let totalImages = 0;
    
    if (countResponse.status === 200) {
      const allData = await countResponse.json();
      totalImages = allData.length;
      console.log(`Total images in DB: ${totalImages} (actual count from all IDs)`);
    } else {
      console.error('Failed to get count, using batch size');
      totalImages = images.length; // Fallback
    }
    
    const totalBatches = Math.ceil(totalImages / BATCH_SIZE);
    const hasMore = requestedBatch < totalBatches - 1;
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
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
          source: 'supabase-background'
        },
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Error getting portfolio from DB:', error);
    throw error;
  }
}

async function updateSyncMeta(metaData) {
  try {
    await supabaseRequest('DELETE', '/rest/v1/portfolio_meta');
    await supabaseRequest('POST', '/rest/v1/portfolio_meta', [metaData]);
  } catch (error) {
    console.error('Error updating sync meta:', error);
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
          aspectratio: guessAspectRatio(item.name),
          path: item.path_lower,
          size: item.size,
          modified: item.server_modified,
          extension: item.name.toLowerCase().substring(item.name.lastIndexOf('.')),
          image_url: null,
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

// Include all helper functions (supabaseRequest, listDropboxFolder, etc.)
async function supabaseRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    
    // Log the request for debugging
    console.log(`Supabase ${method} request to: ${endpoint}`);
    if (data && Array.isArray(data)) {
      console.log(`Request data: ${data.length} items`);
      console.log('First item:', JSON.stringify(data[0], null, 2));
    }
    
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal' // Add this header for better performance
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
        console.log(`Supabase response: ${res.statusCode}, length: ${responseData.length}`);
        if (responseData.length > 0 && responseData.length < 500) {
          console.log('Response data:', responseData);
        }
        
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
      console.error('Supabase request error:', error.message);
      reject(new Error(`Supabase request error: ${error.message}`));
    });
    
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
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