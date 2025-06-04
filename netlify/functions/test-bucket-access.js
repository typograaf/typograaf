// netlify/functions/test-bucket-access.js
// Simple test to check if we can access the Supabase Storage bucket

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== TEST BUCKET ACCESS START ===');
  
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseKey,
      urlPreview: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'missing'
    });
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables',
          details: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey
          }
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client created');
    
    // Test 1: List buckets
    console.log('Testing: List buckets...');
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      console.error('Buckets error:', bucketsError);
    } else {
      console.log('Buckets found:', buckets?.map(b => b.name));
    }
    
    // Test 2: Check if portfolio-images bucket exists
    console.log('Testing: Check portfolio-images bucket...');
    const { data: bucketInfo, error: bucketError } = await supabase.storage.getBucket('portfolio-images');
    
    if (bucketError) {
      console.error('Portfolio bucket error:', bucketError);
    } else {
      console.log('Portfolio bucket info:', bucketInfo);
    }
    
    // Test 3: Try to list files in the bucket
    console.log('Testing: List files in portfolio-images...');
    const { data: files, error: filesError } = await supabase.storage
      .from('portfolio-images')
      .list('', { limit: 10 });
    
    let fileList = [];
    if (filesError) {
      console.error('Files list error:', filesError);
    } else {
      console.log(`Found ${files?.length || 0} items in portfolio-images`);
      fileList = files?.map(f => ({
        name: f.name,
        size: f.metadata?.size,
        type: f.metadata?.mimetype,
        isFolder: !f.metadata
      })) || [];
    }
    
    // Test 4: Database connection
    console.log('Testing: Database connection...');
    const { data: dbTest, error: dbError } = await supabase
      .from('portfolio_images')
      .select('id')
      .limit(1);
    
    let dbStatus = 'error';
    if (dbError) {
      console.error('Database error:', dbError);
    } else {
      console.log('Database connection OK');
      dbStatus = 'ok';
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tests: {
          environment: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey,
            status: 'ok'
          },
          buckets: {
            available: buckets?.map(b => b.name) || [],
            error: bucketsError?.message || null,
            status: bucketsError ? 'error' : 'ok'
          },
          portfolioBucket: {
            exists: !bucketError,
            info: bucketInfo || null,
            error: bucketError?.message || null,
            status: bucketError ? 'error' : 'ok'
          },
          files: {
            count: files?.length || 0,
            items: fileList,
            error: filesError?.message || null,
            status: filesError ? 'error' : 'ok'
          },
          database: {
            status: dbStatus,
            error: dbError?.message || null
          }
        },
        message: 'Test completed - check individual test results',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Test function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
};