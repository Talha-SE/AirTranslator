import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Auth endpoints
export const auth = {
    getDiscordAuthUrl: async () => {
        const response = await api.get('/api/auth/discord');
        return response.data;
    },
    
    handleCallback: async (code) => {
        const response = await api.post('/api/auth/callback', { code });
        if (response.data.sessionToken) {
            // Store session token in cookie
            document.cookie = `session=${response.data.sessionToken}; path=/; max-age=${7 * 24 * 60 * 60}`; // 7 days
        }
        return response.data;
    },
    
    getCurrentUser: async () => {
        const response = await api.get('/api/user/me');
        return response.data;
    },
    
    logout: async () => {
        await api.post('/api/auth/logout');
        document.cookie = 'session=; path=/; max-age=0';
    }
};

// User endpoints
export const user = {
    getGuilds: async () => {
        const response = await api.get('/api/user/guilds');
        return response.data;
    }
};

// Guild endpoints
export const guild = {
    getChannels: async (guildId) => {
        const response = await api.get(`/api/guilds/${guildId}/channels`);
        return response.data;
    },
    
    getConfig: async (guildId) => {
        const response = await api.get(`/api/guilds/${guildId}/config`);
        return response.data;
    },
    
    updateConfig: async (guildId, config) => {
        const response = await api.put(`/api/guilds/${guildId}/config`, config);
        return response.data;
    }
};

export default api;
