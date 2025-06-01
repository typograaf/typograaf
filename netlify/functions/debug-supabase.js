// netlify/functions/debug-supabase.js
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  try {
    console.log('=== DEBUG SUPABASE ===');
    console.log('URL:', SUPABASE_URL);
    console.log('Key exists:', !!SUPABASE_ANON_KEY);
    
    // Step 1: Test basic table query
    console.log('Step 1: Testing basic table query...');
    const step1Response = await supabaseRequest('GET', '/rest/v1/portfolio_images?limit=1');
    console.log('Step 1 status:', step1Response.status);
    
    let step1Data = null;
    try {
      step1Data = await step1Response.json();
      console.log('Step 1 data type:', typeof step1Data);
      console.log('Step 1 data length:', Array.isArray(step1Data) ? step1Data.length : 'not array');
    } catch (e) {
      console.log('Step 1 JSON parse error:', e.message);
    }
    
    // Step 2: Test meta table
    console.log('Step 2: Testing meta table...');
    const step2Response = await supabaseRequest('GET', '/rest/v1/portfolio_meta?limit=1');
    console.log('Step 2 status:', step2Response.status);
    
    let step2Data = null;
    try {
      step2Data = await step2Response.json();
      console.log('Step 2 data:', step2Data);
    } catch (e) {
      console.log('Step 2 JSON parse error:', e.message);
    }
    
    // Step 3: Test count
    console.log('Step 3: Testing count query...');
    const step3Response = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=id');
    console.log('Step 3 status:', step3Response.status);
    
    let step3Data = null;
    try {
      step3Data = await step3Response.json();
      console.log('Step 3 count:', Array.isArray(step3Data) ? step3Data.length : 'not array');
    } catch (e) {
      console.log('Step 3 JSON parse error:', e.message);
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        debug: {
          step1: {
            status: step1Response.status,
            dataType: typeof step1Data,
            isArray: Array.isArray(step1Data),
            length: Array.isArray(step1Data) ? step1Data.length : null,
            sample: step1Data
          },
          step2: {
            status: step2Response.status,
            data: step2Data
          },
          step3: {
            status: step3Response.status,
            count: Array.isArray(step3Data) ? step3Data.length : null
          }
        }
      })
    };
    
  } catch (error) {
    console.error('Debug error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
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
    
    console.log('Making request to:', options.hostname + options.path);
    
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response length:', responseData.length);
        
        res.text = () => responseData;
        res.json = () => {
          try {
            return JSON.parse(responseData);
          } catch (e) {
            console.log('JSON parse failed:', e.message);
            console.log('Raw response:', responseData.substring(0, 200));
            return null;
          }
        };
        resolve(res);
      });
    });
    
    req.on('error', (error) => {
      console.log('Request failed:', error.message);
      reject(new Error(`Supabase request error: ${error.message}`));
    });
    
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}