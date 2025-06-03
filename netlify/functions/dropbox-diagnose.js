// netlify/functions/dropbox-diagnose.js
// Diagnose Dropbox token issues and attempt refresh

exports.handler = async (event, context) => {
  console.log('=== DROPBOX DIAGNOSTIC START ===');
  
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
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    const appKey = process.env.DROPBOX_APP_KEY;
    const appSecret = process.env.DROPBOX_APP_SECRET;
    
    const diagnosis = {
      hasAccessToken: !!dropboxToken,
      hasRefreshToken: !!refreshToken,
      hasAppKey: !!appKey,
      hasAppSecret: !!appSecret,
      accessTokenPreview: dropboxToken ? dropboxToken.substring(0, 20) + '...' : null
    };
    
    console.log('Environment check:', diagnosis);
    
    // Test current access token
    let currentTokenWorks = false;
    let tokenTestError = null;
    
    if (dropboxToken) {
      try {
        console.log('Testing current access token...');
        const testResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${dropboxToken}`
          }
        });
        
        if (testResponse.ok) {
          currentTokenWorks = true;
          const userData = await testResponse.json();
          console.log('Current token works! User:', userData.name?.display_name || 'Unknown');
        } else {
          const errorText = await testResponse.text();
          tokenTestError = `${testResponse.status}: ${errorText}`;
          console.log('Current token failed:', tokenTestError);
        }
      } catch (error) {
        tokenTestError = error.message;
        console.log('Token test error:', error.message);
      }
    }
    
    // Try to refresh token if current one doesn't work
    let refreshResult = null;
    if (!currentTokenWorks && refreshToken && appKey && appSecret) {
      try {
        console.log('Attempting to refresh access token...');
        
        const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
        
        const refreshResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
          })
        });
        
        if (refreshResponse.ok) {
          const newTokens = await refreshResponse.json();
          refreshResult = {
            success: true,
            newAccessToken: newTokens.access_token,
            expiresIn: newTokens.expires_in,
            message: 'Successfully refreshed! Update DROPBOX_ACCESS_TOKEN with the new token.'
          };
          console.log('Token refresh successful!');
        } else {
          const errorText = await refreshResponse.text();
          refreshResult = {
            success: false,
            error: `${refreshResponse.status}: ${errorText}`
          };
          console.log('Token refresh failed:', refreshResult.error);
        }
      } catch (error) {
        refreshResult = {
          success: false,
          error: error.message
        };
        console.log('Refresh attempt error:', error.message);
      }
    }
    
    // Generate recommendations
    const recommendations = [];
    
    if (!dropboxToken) {
      recommendations.push('❌ No DROPBOX_ACCESS_TOKEN found - set this environment variable');
    } else if (!currentTokenWorks) {
      recommendations.push('❌ Current access token is expired/invalid');
      
      if (refreshResult?.success) {
        recommendations.push('✅ Refresh token worked! Update DROPBOX_ACCESS_TOKEN with the new token shown below');
      } else if (!refreshToken) {
        recommendations.push('❌ No refresh token available - run the OAuth flow to get new tokens');
      } else if (!appKey || !appSecret) {
        recommendations.push('❌ Missing DROPBOX_APP_KEY or DROPBOX_APP_SECRET for token refresh');
      } else {
        recommendations.push('❌ Refresh token also failed - may need to re-run OAuth flow');
      }
    } else {
      recommendations.push('✅ Current access token is working correctly!');
    }
    
    if (!appKey || !appSecret) {
      recommendations.push('⚠️ Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET for automatic token refresh');
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        diagnosis: diagnosis,
        currentTokenWorks: currentTokenWorks,
        tokenTestError: tokenTestError,
        refreshResult: refreshResult,
        recommendations: recommendations,
        nextSteps: currentTokenWorks ? 
          'Your Dropbox token is working! Try running the image migration again.' :
          refreshResult?.success ?
          'Update your DROPBOX_ACCESS_TOKEN environment variable with the new token, then try again.' :
          'Visit /oauth.html to get new tokens via OAuth flow.',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Diagnostic error:', error);
    
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