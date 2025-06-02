// netlify/functions/auto-sync-portfolio.js
exports.handler = async (event, context) => {
  console.log('=== AUTO SYNC ORCHESTRATOR START ===');
  
  try {
    const baseUrl = `https://${event.headers.host}`;
    let chunk = 0;
    let totalProcessed = 0;
    
    // Process chunks sequentially until all done
    while (true) {
      console.log(`Processing chunk ${chunk}...`);
      
      const response = await fetch(`${baseUrl}/.netlify/functions/sync-dropbox-chunks?chunk=${chunk}`);
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`Chunk ${chunk} failed: ${result.error}`);
      }
      
      totalProcessed += result.imagesProcessed || 0;
      console.log(`Chunk ${chunk} completed. Images: ${result.imagesProcessed || 0}`);
      
      // If no more chunks, we're done
      if (!result.hasMoreChunks) {
        console.log('All chunks completed!');
        break;
      }
      
      chunk++;
      
      // Safety limit to prevent infinite loops
      if (chunk > 50) {
        console.log('Safety limit reached, stopping');
        break;
      }
      
      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`=== AUTO SYNC COMPLETE ===`);
    console.log(`Total images processed: ${totalProcessed}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        totalChunks: chunk + 1,
        totalImagesProcessed: totalProcessed,
        message: `Successfully processed all ${chunk + 1} chunks with ${totalProcessed} total images`
      })
    };
    
  } catch (error) {
    console.error('=== AUTO SYNC ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};