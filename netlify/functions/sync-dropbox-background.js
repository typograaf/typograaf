// netlify/functions/sync-dropbox-background.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== BACKGROUND FUNCTION START ===');
  
  try {
    // Check environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    console.log('Environment check:');
    console.log('- SUPABASE_URL exists:', !!supabaseUrl);
    console.log('- SUPABASE_ANON_KEY exists:', !!supabaseKey);
    
    if (!supabaseUrl || !supabaseKey) {
      console.log('=== MISSING ENVIRONMENT VARIABLES ===');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing Supabase configuration',
          debug: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey
          }
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('=== CALLING SUPABASE ===');
    console.log('URL:', supabaseUrl.substring(0, 30) + '...');
    
    // Get portfolio images from database
    const { data: images, error } = await supabase
      .from('portfolio_images')
      .select('*')
      .order('modified', { ascending: false });
    
    if (error) {
      console.error('=== SUPABASE ERROR ===');
      console.error('Error:', error);
      
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: `Supabase query error: ${error.message}`,
          details: error
        })
      };
    }
    
    console.log('=== SUPABASE SUCCESS ===');
    console.log('Images found:', images ? images.length : 0);
    
    // Process the images data to ensure it's properly formatted
    const processedImages = images ? images.map(img => ({
      id: img.id || `fallback-${img.name}-${Date.now()}`,
      name: img.name || 'Untitled',
      project: img.project || 'Unknown Project',
      tool: img.tool || 'Unknown Tool',
      type: img.type || 'Unknown Type',
      time: img.time || '2024-Q1',
      aspectratio: parseFloat(img.aspectratio) || 1.33,
      path: img.path || '',
      size: img.size || 0,
      modified: img.modified || new Date().toISOString(),
      extension: img.extension || 'jpg',
      image_url: img.image_url || null,
      scanned: img.scanned || new Date().toISOString()
    })) : [];
    
    // Handle empty database gracefully
    const stats = {
      totalImages: processedImages.length,
      imagesWithUrls: processedImages.filter(img => img.image_url).length,
      imagesWithoutUrls: processedImages.filter(img => !img.image_url).length,
      source: 'database',
      isEmpty: processedImages.length === 0
    };
    
    const projects = processedImages.length > 0 ? 
      [...new Set(processedImages.map(img => img.project))].filter(Boolean) : [];
    
    console.log('=== PROCESSED DATA ===');
    console.log('Processed images:', processedImages.length);
    console.log('Projects found:', projects.length);
    console.log('Images with URLs:', stats.imagesWithUrls);
    
    console.log('=== RETURNING SUCCESS RESPONSE ===');
    
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
        images: processedImages,
        stats: stats,
        projects: projects,
        message: processedImages.length === 0 ? 
          'Database is empty - no images found' : 
          `Found ${processedImages.length} images`,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('=== FUNCTION ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // More specific error handling
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.message.includes('string did not match the expected pattern')) {
      errorMessage = 'Database connection string format error. Check your Supabase URL format.';
      statusCode = 500;
    } else if (error.message.includes('Invalid API key')) {
      errorMessage = 'Invalid Supabase API key. Check your SUPABASE_ANON_KEY.';
      statusCode = 401;
    } else if (error.message.includes('relation') && error.message.includes('does not exist')) {
      errorMessage = 'Database table "portfolio_images" does not exist. Run your SQL setup first.';
      statusCode = 500;
    }
    
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        originalError: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};