// netlify/functions/get-image.js
const https = require('https');

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

exports.handler = async (event, context) => {
  try {
    if (!DROPBOX_ACCESS_TOKEN) {
      throw new Error('DROPBOX_ACCESS_TOKEN environment variable not set');
    }
    
    const queryParams = event.queryStringParameters || {};
    const imagePath = queryParams.path;
    
    if (!imagePath) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing path parameter'
        })
      };
    }
    
    console.log('Getting image URL for:', imagePath);
    const imageUrl = await getDropboxImageUrl(imagePath);
    
    if (imageUrl) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          imageUrl: imageUrl,
          path: imagePath,
          timestamp: new Date().toISOString()
        })
      };
    } else {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Image not found or could not generate URL',
          path: imagePath
        })
      };
    }
    
  } catch (error) {
    console.error('Get image error:', error);
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
            console.error(`Failed to get image URL for ${path}:`, jsonData.error_summary || data);
            resolve(null);
          }
        } catch (parseError) {
          console.error(`Failed to parse response for ${path}:`, parseError.message);
          resolve(null);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`Request error for ${path}:`, error.message);
      resolve(null);
    });
    
    req.write(postData);
    req.end();
  });
}