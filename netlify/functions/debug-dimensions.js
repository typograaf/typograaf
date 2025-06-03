// netlify/functions/debug-dimensions.js
// Check what's happening with the dimension calculation

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DEBUG DIMENSIONS STATUS ===');
  
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
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing environment variables'
        })
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Checking database status...');
    
    // Get all images
    const { data: allImages, error: allError } = await supabase
      .from('portfolio_images')
      .select('id, name, storage_url, width, height, aspectratio, dimensions_calculated')
      .order('name');
    
    if (allError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: allError.message
        })
      };
    }
    
    // Analyze the data
    const totalImages = allImages.length;
    const withStorageUrl = allImages.filter(img => img.storage_url).length;
    const withWidth = allImages.filter(img => img.width !== null).length;
    const withHeight = allImages.filter(img => img.height !== null).length;
    const withBothDimensions = allImages.filter(img => img.width !== null && img.height !== null).length;
    const withDimensionsCalculated = allImages.filter(img => img.dimensions_calculated).length;
    
    // Get images that should be processed by fix-dimensions
    const { data: needingDimensions, error: needingError } = await supabase
      .from('portfolio_images')
      .select('id, name, storage_url, width, height')
      .not('storage_url', 'is', null)
      .or('width.is.null,height.is.null')
      .limit(5);
    
    // Sample of images with storage URLs
    const { data: sampleWithStorage, error: sampleError } = await supabase
      .from('portfolio_images')
      .select('id, name, storage_url, width, height, aspectratio, dimensions_calculated')
      .not('storage_url', 'is', null)
      .limit(5);
    
    const analysis = {
      totalImages: totalImages,
      withStorageUrl: withStorageUrl,
      withWidth: withWidth,
      withHeight: withHeight,
      withBothDimensions: withBothDimensions,
      withDimensionsCalculated: withDimensionsCalculated,
      needingDimensionsCount: needingDimensions?.length || 0,
      
      // Breakdown
      hasStorageButNoDimensions: withStorageUrl - withBothDimensions,
      hasStorageAndDimensions: withBothDimensions,
      
      // Sample data
      sampleNeedingDimensions: needingDimensions?.map(img => ({
        name: img.name,
        hasStorageUrl: !!img.storage_url,
        hasWidth: img.width !== null,
        hasHeight: img.height !== null,
        storageUrlPreview: img.storage_url ? img.storage_url.substring(0, 50) + '...' : null
      })) || [],
      
      sampleWithStorage: sampleWithStorage?.map(img => ({
        name: img.name,
        hasStorageUrl: !!img.storage_url,
        width: img.width,
        height: img.height,
        aspectratio: img.aspectratio,
        hasDimensionsCalculated: !!img.dimensions_calculated
      })) || []
    };
    
    console.log('Analysis:', analysis);
    
    // Test if we can access one storage URL
    let storageUrlTest = null;
    if (sampleWithStorage && sampleWithStorage.length > 0) {
      const testImage = sampleWithStorage[0];
      try {
        console.log(`Testing storage URL: ${testImage.storage_url}`);
        const testResponse = await fetch(testImage.storage_url, { method: 'HEAD' });
        storageUrlTest = {
          url: testImage.storage_url,
          status: testResponse.status,
          ok: testResponse.ok,
          headers: {
            contentType: testResponse.headers.get('content-type'),
            contentLength: testResponse.headers.get('content-length')
          }
        };
      } catch (error) {
        storageUrlTest = {
          url: testImage.storage_url,
          error: error.message
        };
      }
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        analysis: analysis,
        storageUrlTest: storageUrlTest,
        recommendations: [
          totalImages === 0 ? '❌ No images in database - run Dropbox sync first' : '✅ Images found in database',
          withStorageUrl === 0 ? '❌ No images in Supabase Storage - run migration first' : `✅ ${withStorageUrl} images in Supabase Storage`,
          analysis.hasStorageButNoDimensions > 0 ? `⚠️ ${analysis.hasStorageButNoDimensions} images need dimension calculation` : '✅ All images have dimensions',
          storageUrlTest?.ok ? '✅ Storage URLs are accessible' : '❌ Storage URLs may not be accessible'
        ],
        nextSteps: analysis.hasStorageButNoDimensions > 0 ? 
          'Images need dimension calculation - check why the fix-dimensions function is failing' :
          'All images have dimensions calculated!',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Debug error:', error);
    
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