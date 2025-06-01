// netlify/functions/sync-dropbox-background.js - Simple Test Version
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  console.log('🔍 Function started');
  
  try {
    // Get portfolio images from database
    console.log('🔗 Getting portfolio from database...');
    
    const response = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=*&order=project,tool,name');
    const data = await response.json();
    
    console.log('📊 Database response:', {
      imageCount: data ? data.length : 0,
      withUrls: data ? data.filter(img => img.image_url).length : 0,
      withoutUrls: data ? data.filter(img => !img.image_url).length : 0
    });
    
    if (data && Array.isArray(data) && data.length > 0) {
      console.log('✅ Successfully loaded images from database');
      
      // Process the data to match your website's expected format
      const processedImages = data.map(img => ({
        id: img.id,
        name: img.name,
        project: img.project,
        tool: img.tool,
        type: img.type,
        time: img.time,
        aspectratio: img.aspectratio,
        path: img.path,
        size: img.size,
        modified: img.modified,
        extension: img.extension,
        image_url: img.image_url, // This is the key field for actual images
        scanned: img.scanned,
        url_fetched: img.url_fetched
      }));
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          images: processedImages,
          batch: {
            current: 0,
            total: 1,
            hasMore: false,
            nextBatch: null
          },
          stats: {
            totalImages: processedImages.length,
            imagesWithUrls: processedImages.filter(img => img.image_url).length,
            imagesWithoutUrls: processedImages.filter(img => !img.image_url).length,
            batchSize: processedImages.length,
            cached: true,
            source: 'supabase-database'
          },
          projects: [...new Set(processedImages.map(img => img.project))],
          tools: [...new Set(processedImages.map(img => img.tool))],
          types: [...new Set(processedImages.map(img => img.type))],
          timestamp: new Date().toISOString()
        })
      };
    } else {
      console.log('❌ No images found in database');
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          message: 'No images found in database',
          images: [],
          timestamp: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('💥 Function error:', error);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        message: 'Function error',
        error: error.message,
        images: [],
        timestamp: new Date().toISOString()
      })
    };
  }
};

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
        // Add statusCode to response object
        res.statusCode = res.statusCode;
        res.text = () => responseData;
        res.json = () => {
          try {
            return JSON.parse(responseData);
          } catch (e) {
            console.error('JSON parse error:', e);
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