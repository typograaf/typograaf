exports.handler = async (event, context) => {
  try {
    // Check if environment variable exists
    const token = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!token) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'DROPBOX_ACCESS_TOKEN environment variable not set',
          timestamp: new Date().toISOString()
        })
      };
    }

    // Your Dropbox API code goes here
    // For now, return success with the token (first 10 chars for verification)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Token found',
        tokenPreview: token.substring(0, 10) + '...',
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
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