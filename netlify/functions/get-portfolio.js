// netlify/functions/get-portfolio.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== GET PORTFOLIO START ===');
  
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.log('Missing Supabase environment variables');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing Supabase configuration',
          images: []
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get portfolio images
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('Supabase query error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: error.message,
          images: []
        })
      };
    }
    
    console.log(`Retrieved ${images?.length || 0} images from database`);
    
    // Get metadata
    const { data: meta } = await supabase
      .from('portfolio_meta')
      .select('*')
      .single();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        images: images || [],
        meta: meta || null,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== GET PORTFOLIO ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        images: [],
        timestamp: new Date().toISOString()
      })
    };
  }
};