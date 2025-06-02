// netlify/functions/auto-sync-portfolio.js
exports.handler = async (event, context) => {
  console.log('=== SIMPLE AUTO SYNC START ===');
  
  try {
    const baseUrl = `https://${event.headers.host}`;
    const maxChunks = 10; // Limit to prevent infinite loops
    const results = [];
    
    console.log('Starting sequential chunk processing...');
    
    // Process chunks one by one with delays
    for (let chunk = 0; chunk < maxChunks; chunk++) {
      console.log(`Starting chunk ${chunk}...`);
      
      try {
        const response = await fetch(`${baseUrl}/.netlify/functions/sync-dropbox-chunks?chunk=${chunk}`, {
          timeout: 15000 // 15 second timeout per chunk
        });
        
        if (!response.ok) {
          console.error(`Chunk ${chunk} HTTP error: ${response.status}`);
          break;
        }
        
        const result = await response.json();
        console.log(`Chunk ${chunk} result:`, result);
        
        if (!result.success) {
          console.error(`Chunk ${chunk} failed: ${result.error}`);
          break;
        }
        
        results.push({
          chunk: chunk,
          project: result.projectName,
          images: result.imagesProcessed || 0
        });
        
        // If no more chunks, we're done
        if (!result.hasMoreChunks) {
          console.log(`All chunks completed! Processed ${chunk + 1} projects.`);
          break;
        }
        
        // Add delay between chunks to prevent overwhelming
        console.log('Waiting 2 seconds before next chunk...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (chunkError) {
        console.error(`Chunk ${chunk} error:`, chunkError.message);
        // Continue to next chunk instead of failing completely
        results.push({
          chunk: chunk,
          error: chunkError.message,
          images: 0
        });
      }
    }
    
    const totalImages = results.reduce((sum, r) => sum + (r.images || 0), 0);
    const successfulChunks = results.filter(r => !r.error).length;
    
    console.log(`=== SYNC SUMMARY ===`);
    console.log(`Successful chunks: ${successfulChunks}`);
    console.log(`Total images processed: ${totalImages}`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        chunks: results,
        totalChunks: successfulChunks,
        totalImagesProcessed: totalImages,
        message: `Processed ${successfulChunks} projects with ${totalImages} total images`
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
};// netlify/functions/auto-sync-portfolio.js
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