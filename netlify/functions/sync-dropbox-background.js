// netlify/functions/sync-dropbox-background.js - Simple Test Version
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  console.log('🔍 Function started');
  console.log('Environment check:', {
    hasSupabaseUrl: !!SUPABASE_URL,
    hasSupabaseKey: !!SUPABASE_ANON_KEY,
    supabaseUrlPreview: SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : 'missing'
  });
  
  try {
    // Just try to connect to Supabase and count images
    console.log('🔗 Testing Supabase connection...');
    
    const response = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=id&limit=5');
    console.log('📊 Response status:', response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      console.log('✅ Success! Found images:', data.length);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          message: `Database connected! Found ${data.length} images`,
          sampleIds: data.map(img => img.id),
          timestamp: new Date().toISOString()
        })
      };
    } else {
      const errorText = await response.text();
      console.error('❌ Database error:', response.status, errorText);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          message: `Database error: ${response.status}`,
          error: errorText,
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
        message: 'Function crashed',
        error: error.message,
        stack: error.stack,
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