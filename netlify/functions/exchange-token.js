// netlify/functions/exchange-token.js
// TEMPORARY FUNCTION - DELETE AFTER USE

exports.handler = async (event, context) => {
  console.log('=== TOKEN EXCHANGE START ===');
  
  // Get code from query parameter
  const code = event.queryStringParameters?.code;
  
  if (!code) {
    return {
      statusCode: 400,
      body: 'Missing code parameter. Add ?code=YOUR_CODE to the URL'
    };
  }
  
  const appKey = 'kfu36twabg19hc4';
  const appSecret = 'c26nuhi3kw5ek2j';
  const redirectUri = 'http://localhost:3000';
  
  try {
    console.log('Exchanging code for tokens...');
    
    // Create basic auth header
    const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
    
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Token exchange failed:', response.status, errorText);
      
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Token exchange failed',
          status: response.status,
          details: errorText
        })
      };
    }
    
    const tokens = await response.json();
    console.log('Token exchange successful!');
    
    // Return tokens (but don't log them for security)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Token exchange successful! Add these to your Netlify environment variables:',
        environment_variables: {
          DROPBOX_ACCESS_TOKEN: tokens.access_token,
          DROPBOX_REFRESH_TOKEN: tokens.refresh_token,
          DROPBOX_APP_KEY: appKey,
          DROPBOX_APP_SECRET: appSecret
        },
        expires_in: tokens.expires_in,
        token_type: tokens.token_type
      })
    };
    
  } catch (error) {
    console.error('Exchange error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};