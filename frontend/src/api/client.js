import axios from 'axios';

// Connect proxy to our FastAPI backend
export const apiClient = axios.create({
    baseURL: 'http://localhost:8000',
    headers: {
        'Content-Type': 'application/json'
    }
});

// Mock functions for UI interactions (if backend doesn't exist locally)
export const createDatasetNode = async (datasetConfig) => {
    try {
        const response = await apiClient.post('/pipelines/dataset/create', datasetConfig);
        return response.data;
    } catch (error) {
        console.error("Error creating dataset:", error);
        throw error;
    }
};

export const runPipeline = async () => {
    try {
        const response = await apiClient.post('/pipelines/run');
        return response.data;
    } catch (error) {
        console.error("Error running pipeline:", error);
        throw error;
    }
};

export const deployWorkflow = async (workflowPayload) => {
    try {
        const response = await apiClient.post('/pipelines/deploy_workflow', workflowPayload);
        return response.data;
    } catch (error) {
        console.error("Error deploying workflow:", error);
        throw error;
    }
};
