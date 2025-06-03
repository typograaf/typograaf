// netlify/functions/get-portfolio.js
// Simple function that just reads the data without any complex string operations

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== SIMPLE READ FUNCTION START ===');
  
  // Add CORS headers for all requests
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }
  
  try {
    // Get environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables',
          message: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured'
        })
      };
    }
    
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple query
    const { data, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('Supabase error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Database query failed',
          message: error.message
        })
      };
    }
    
    // Format the response
    const images = data || [];
    console.log(`Successfully retrieved ${images.length} images`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        images: images,
        count: images.length,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Function execution failed',
        message: error.message
      })
    };
  }
};