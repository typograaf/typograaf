// netlify/functions/check-database-schema.js
// Check the database table structure

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  console.log('=== CHECK DATABASE SCHEMA START ===');
  
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
      throw new Error('Missing environment variables');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('Checking database schema...');
    
    // Test 1: Try to query the table
    const { data: tableData, error: tableError } = await supabase
      .from('portfolio_images')
      .select('*')
      .limit(3);
    
    console.log('Table query result:', { tableData, tableError });
    
    // Test 2: Try a simple insert to see what happens
    const testRecord = {
      name: 'test-image',
      project: 'test-project',
      tool: 'test-tool',
      type: 'image',
      extension: 'jpg'
    };
    
    console.log('Testing insert with minimal data...');
    const { data: insertData, error: insertError } = await supabase
      .from('portfolio_images')
      .insert(testRecord)
      .select();
    
    console.log('Insert test result:', { insertData, insertError });
    
    // Test 3: Try insert with explicit id
    const testRecordWithId = {
      id: 999999, // Use a high number to avoid conflicts
      name: 'test-image-with-id',
      project: 'test-project',
      tool: 'test-tool',
      type: 'image',
      extension: 'jpg'
    };
    
    console.log('Testing insert with explicit id...');
    const { data: insertWithIdData, error: insertWithIdError } = await supabase
      .from('portfolio_images')
      .insert(testRecordWithId)
      .select();
    
    console.log('Insert with id test result:', { insertWithIdData, insertWithIdError });
    
    // Clean up test records
    if (insertData && insertData.length > 0) {
      await supabase
        .from('portfolio_images')
        .delete()
        .eq('name', 'test-image');
    }
    
    if (insertWithIdData && insertWithIdData.length > 0) {
      await supabase
        .from('portfolio_images')
        .delete()
        .eq('id', 999999);
    }
    
    // Test 4: Check what columns exist by looking at existing data
    const { data: sampleData } = await supabase
      .from('portfolio_images')
      .select('*')
      .limit(1);
    
    let columnInfo = null;
    if (sampleData && sampleData.length > 0) {
      columnInfo = Object.keys(sampleData[0]);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tests: {
          tableQuery: {
            success: !tableError,
            error: tableError?.message || null,
            recordCount: tableData?.length || 0
          },
          insertWithoutId: {
            success: !insertError,
            error: insertError?.message || null,
            insertedData: insertData || null
          },
          insertWithId: {
            success: !insertWithIdError,
            error: insertWithIdError?.message || null,
            insertedData: insertWithIdData || null
          }
        },
        schemaInfo: {
          existingColumns: columnInfo,
          sampleRecord: sampleData && sampleData.length > 0 ? sampleData[0] : null
        },
        recommendations: [
          !tableError ? '✅ Table exists and is queryable' : '❌ Table query failed',
          !insertError ? '✅ Insert without id works (auto-increment enabled)' : '❌ Insert without id fails (need to provide id)',
          !insertWithIdError ? '✅ Insert with explicit id works' : '❌ Insert with explicit id fails'
        ],
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Schema check error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};