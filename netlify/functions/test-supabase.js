// netlify/functions/test-supabase.js
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  try {
    console.log('Testing Supabase connection...');
    
    // Check environment variables
    const envCheck = {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasSupabaseKey: !!SUPABASE_ANON_KEY,
      supabaseUrlFormat: SUPABASE_URL ? SUPABASE_URL.substring(0, 20) + '...' : 'missing',
      supabaseKeyFormat: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'missing'
    };
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables',
          details: envCheck
        })
      };
    }
    
    // Test basic connection
    console.log('Testing connection to:', SUPABASE_URL);
    const testResponse = await supabaseRequest('GET', '/rest/v1/');
    
    if (testResponse.status !== 200) {
      const errorText = await testResponse.text();
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Supabase connection failed',
          details: {
            status: testResponse.status,
            error: errorText,
            envCheck
          }
        })
      };
    }
    
    // Test table access
    console.log('Testing table access...');
    const tableResponse = await supabaseRequest('GET', '/rest/v1/portfolio_images?select=count');
    
    if (tableResponse.status !== 200) {
      const errorText = await tableResponse.text();
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Table access failed',
          details: {
            status: tableResponse.status,
            error: errorText,
            envCheck,
            suggestion: 'Check if tables exist in Supabase Table Editor'
          }
        })
      };
    }
    
    const tableData = await tableResponse.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Supabase connection successful!',
        details: {
          envCheck,
          tableCount: tableData.length > 0 ? tableData[0].count : 0,
          connectionStatus: 'OK'
        }
      })
    };
    
  } catch (error) {
    console.error('Test error:', error);
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