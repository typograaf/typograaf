// netlify/functions/dropbox-oauth.js
// Handle Dropbox OAuth flow to get refresh tokens

exports.handler = async (event, context) => {
  console.log('=== DROPBOX OAUTH HANDLER ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  try {
    const { code, action } = JSON.parse(event.body || '{}');
    
    if (action === 'get-auth-url') {
      // Generate authorization URL
      const appKey = process.env.DROPBOX_APP_KEY;
      const redirectUri = 'https://typograaf.netlify.app';
      
      if (!appKey) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'DROPBOX_APP_KEY not configured'
          })
        };
      }
      
      const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&token_access_type=offline`;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          authUrl: authUrl,
          instructions: 'Visit this URL, authorize the app, and copy the code from the redirect URL'
        })
      };
    }
    
    if (action === 'exchange-code' && code) {
      // Exchange authorization code for tokens
      const appKey = process.env.DROPBOX_APP_KEY;
      const appSecret = process.env.DROPBOX_APP_SECRET;
      const redirectUri = 'https://typograaf.netlify.app';
      
      if (!appKey || !appSecret) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'DROPBOX_APP_KEY or DROPBOX_APP_SECRET not configured'
          })
        };
      }
      
      const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
      
      const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Token exchange failed: ${response.status} - ${errorText}`
          })
        };
      }
      
      const tokens = await response.json();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          tokens: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in
          },
          instructions: 'Add these to your Netlify environment variables:\nDROPBOX_ACCESS_TOKEN=' + tokens.access_token + '\nDROPBOX_REFRESH_TOKEN=' + tokens.refresh_token
        })
      };
    }
    
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Invalid action or missing code'
      })
    };
    
  } catch (error) {
    console.error('OAuth error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};