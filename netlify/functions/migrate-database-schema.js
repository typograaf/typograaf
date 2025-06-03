// netlify/functions/migrate-database-schema.js
// Adds dimension columns to portfolio_images table

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== DATABASE SCHEMA MIGRATION START ===');
  
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
    
    console.log('Checking current table schema...');
    
    // Check if columns already exist
    const { data: columns, error: columnsError } = await supabase.rpc('get_table_columns', {
      table_name: 'portfolio_images'
    });
    
    if (columnsError) {
      console.log('Could not check columns, attempting to add anyway...');
    }
    
    const migrations = [];
    
    // Add width column if it doesn't exist
    try {
      console.log('Adding width column...');
      const { error: widthError } = await supabase.rpc('exec_sql', {
        sql: 'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS width INTEGER;'
      });
      
      if (widthError) {
        console.error('Width column error:', widthError);
        migrations.push({ column: 'width', status: 'failed', error: widthError.message });
      } else {
        migrations.push({ column: 'width', status: 'success' });
      }
    } catch (error) {
      migrations.push({ column: 'width', status: 'failed', error: error.message });
    }
    
    // Add height column if it doesn't exist
    try {
      console.log('Adding height column...');
      const { error: heightError } = await supabase.rpc('exec_sql', {
        sql: 'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS height INTEGER;'
      });
      
      if (heightError) {
        console.error('Height column error:', heightError);
        migrations.push({ column: 'height', status: 'failed', error: heightError.message });
      } else {
        migrations.push({ column: 'height', status: 'success' });
      }
    } catch (error) {
      migrations.push({ column: 'height', status: 'failed', error: error.message });
    }
    
    // Add dimensions_calculated timestamp column
    try {
      console.log('Adding dimensions_calculated column...');
      const { error: timestampError } = await supabase.rpc('exec_sql', {
        sql: 'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS dimensions_calculated TIMESTAMPTZ;'
      });
      
      if (timestampError) {
        console.error('Timestamp column error:', timestampError);
        migrations.push({ column: 'dimensions_calculated', status: 'failed', error: timestampError.message });
      } else {
        migrations.push({ column: 'dimensions_calculated', status: 'success' });
      }
    } catch (error) {
      migrations.push({ column: 'dimensions_calculated', status: 'failed', error: error.message });
    }
    
    // Try alternative approach if RPC doesn't work
    if (migrations.every(m => m.status === 'failed')) {
      console.log('RPC approach failed, trying direct SQL...');
      
      try {
        // Simple approach - just try to select the columns
        const { data: testData, error: testError } = await supabase
          .from('portfolio_images')
          .select('width, height, dimensions_calculated')
          .limit(1);
        
        if (!testError) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'All dimension columns already exist! Schema is ready.',
              migrations: [
                { column: 'width', status: 'already_exists' },
                { column: 'height', status: 'already_exists' },
                { column: 'dimensions_calculated', status: 'already_exists' }
              ],
              timestamp: new Date().toISOString()
            })
          };
        }
      } catch (error) {
        console.log('Columns do not exist yet');
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Could not add columns using RPC. Please add manually in Supabase dashboard.',
          migrations: migrations,
          manualSQL: [
            'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS width INTEGER;',
            'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS height INTEGER;',
            'ALTER TABLE portfolio_images ADD COLUMN IF NOT EXISTS dimensions_calculated TIMESTAMPTZ;'
          ],
          instructions: 'Go to Supabase Dashboard → SQL Editor → Run the manual SQL commands above',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    const successCount = migrations.filter(m => m.status === 'success').length;
    const failedCount = migrations.filter(m => m.status === 'failed').length;
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: successCount > 0,
        message: `Schema migration completed: ${successCount} columns added, ${failedCount} failed`,
        migrations: migrations,
        nextStep: successCount > 0 ? 
          'Schema ready! You can now run the enhanced migration to calculate dimensions.' :
          'Some columns failed to add. Check the migrations array for details.',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Schema migration error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        manualInstructions: 'If automatic migration fails, add these columns manually in Supabase Dashboard',
        manualSQL: [
          'ALTER TABLE portfolio_images ADD COLUMN width INTEGER;',
          'ALTER TABLE portfolio_images ADD COLUMN height INTEGER;',
          'ALTER TABLE portfolio_images ADD COLUMN dimensions_calculated TIMESTAMPTZ;'
        ]
      })
    };
  }
};