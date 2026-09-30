-- Register Gemini models for AI.IF analysis and fraud detection

-- Register gemini-3.5-flash-lite (used by backend)
DO $$
BEGIN
    CALL google_ml.create_model(
        model_id => 'gemini-3.5-flash-lite',
        model_request_url => 'https://aiplatform.googleapis.com/v1/projects/${project_id}/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent',
        model_qualified_name => 'gemini-3.5-flash-lite',
        model_provider => 'google',
        model_type => 'llm',
        model_auth_type => 'alloydb_service_agent_iam'
    );
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM ~ 'Model already exists' THEN
            RAISE NOTICE 'Model gemini-3.5-flash-lite already exists, skipping.';
        ELSE
            RAISE;
        END IF;
END $$;

-- Register gemini-3.1-pro-preview (mentioned in docs)
DO $$
BEGIN
    CALL google_ml.create_model(
        model_id => 'gemini-3.1-pro-preview',
        model_request_url => 'https://aiplatform.googleapis.com/v1/projects/${project_id}/locations/global/publishers/google/models/gemini-3.1-pro-preview:generateContent',
        model_qualified_name => 'gemini-3.1-pro-preview',
        model_provider => 'google',
        model_type => 'llm',
        model_auth_type => 'alloydb_service_agent_iam'
    );
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM ~ 'Model already exists' THEN
            RAISE NOTICE 'Model gemini-3.1-pro-preview already exists, skipping.';
        ELSE
            RAISE;
        END IF;
END $$;
