import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, user, guild } from '../utils/api';
import './Dashboard.css';

function Dashboard() {
    const [currentUser, setCurrentUser] = useState(null);
    const [guilds, setGuilds] = useState([]);
    const [selectedGuild, setSelectedGuild] = useState(null);
    const [channels, setChannels] = useState([]);
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingChannels, setLoadingChannels] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const loadUserData = async () => {
            try {
                setLoading(true);
                const userData = await auth.getCurrentUser();
                setCurrentUser(userData.user);

                const guildsData = await user.getGuilds();
                setGuilds(guildsData.guilds || []);
            } catch (err) {
                console.error('Error loading user data:', err);
                if (err.response?.status === 401) {
                    navigate('/');
                } else {
                    setError('Failed to load user data');
                }
            } finally {
                setLoading(false);
            }
        };

        loadUserData();
    }, [navigate]);

    useEffect(() => {
        if (selectedGuild) {
            const loadGuildData = async (guildId) => {
                try {
                    setLoadingChannels(true);
                    setError('');

                    const [channelsData, configData] = await Promise.all([
                        guild.getChannels(guildId),
                        guild.getConfig(guildId).catch(() => ({ config: null }))
                    ]);

                    setChannels(channelsData.channels || []);
                    setConfig(configData.config);
                } catch (err) {
                    console.error('Error loading guild data:', err);
                    setError('Failed to load server data: ' + (err.response?.data?.error || err.message));
                } finally {
                    setLoadingChannels(false);
                }
            };

            loadGuildData(selectedGuild.id);
        }
    }, [selectedGuild]);

    const handleLogout = async () => {
        try {
            await auth.logout();
            navigate('/');
        } catch (err) {
            console.error('Logout error:', err);
        }
    };

    const getAvatarUrl = (user) => {
        if (user.avatar) {
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
        }
        return `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator) % 5}.png`;
    };

    const getGuildIconUrl = (guild) => {
        if (guild.icon) {
            return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`;
        }
        return null;
    };

    if (loading) {
        return (
            <div className="dashboard-loading">
                <div className="spinner-large"></div>
                <p>Loading dashboard...</p>
            </div>
        );
    }

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div className="header-content">
                    <h1>🌍 AirTranslator Dashboard</h1>
                    <div className="user-info">
                        {currentUser && (
                            <>
                                <img 
                                    src={getAvatarUrl(currentUser)} 
                                    alt={currentUser.username}
                                    className="user-avatar"
                                />
                                <span className="user-name">
                                    {currentUser.global_name || currentUser.username}
                                </span>
                                <button onClick={handleLogout} className="logout-btn">
                                    Logout
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="dashboard-main">
                <div className="dashboard-container">
                    <div className="servers-section">
                        <h2>Your Servers</h2>
                        {error && selectedGuild && (
                            <div className="error-banner">
                                ⚠️ {error}
                            </div>
                        )}
                        {guilds.length === 0 ? (
                            <div className="empty-state">
                                <p>🤖 No servers found</p>
                                <p className="empty-state-hint">
                                    The bot needs to be invited to your servers first.
                                </p>
                                <a 
                                    href={`https://discord.com/api/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID || ''}&permissions=8&scope=bot%20applications.commands`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="invite-bot-btn"
                                >
                                    Invite Bot
                                </a>
                            </div>
                        ) : (
                            <div className="servers-grid">
                                {guilds.map((g) => (
                                    <div
                                        key={g.id}
                                        className={`server-card ${selectedGuild?.id === g.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedGuild(g)}
                                    >
                                        {getGuildIconUrl(g) ? (
                                            <img 
                                                src={getGuildIconUrl(g)} 
                                                alt={g.name}
                                                className="server-icon"
                                            />
                                        ) : (
                                            <div className="server-icon-placeholder">
                                                {g.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="server-info">
                                            <h3>{g.name}</h3>
                                            {g.memberCount && (
                                                <p>{g.memberCount} members</p>
                                            )}
                                        </div>
                                        {selectedGuild?.id === g.id && (
                                            <div className="selected-indicator">✓</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedGuild && (
                        <div className="server-details">
                            <h2>
                                Server Settings: {selectedGuild.name}
                            </h2>

                            {loadingChannels ? (
                                <div className="loading-state">
                                    <div className="spinner"></div>
                                    <p>Loading channels...</p>
                                </div>
                            ) : (
                                <>
                                    <div className="channels-section">
                                        <h3>📺 Available Channels</h3>
                                        {channels.length === 0 ? (
                                            <p className="no-channels">No text channels found</p>
                                        ) : (
                                            <div className="channels-list">
                                                {channels.map((channel) => (
                                                    <div key={channel.id} className="channel-item">
                                                        <span className="channel-hash">#</span>
                                                        <span className="channel-name">{channel.name}</span>
                                                        {channel.category && (
                                                            <span className="channel-category">
                                                                {channel.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="config-section">
                                        <h3>⚙️ Translation Setup</h3>
                                        {config && config.setups && config.setups.length > 0 ? (
                                            <div className="setups-list">
                                                {config.setups.map((setup, index) => (
                                                    <div key={setup.setupId || index} className="setup-item">
                                                        <h4>{setup.name}</h4>
                                                        <div className="setup-channels">
                                                            {setup.channels.map((ch, idx) => {
                                                                const channelInfo = channels.find(c => c.id === ch.channelId);
                                                                return (
                                                                    <div key={idx} className="setup-channel">
                                                                        <span className="channel-tag">
                                                                            #{channelInfo?.name || ch.channelId}
                                                                        </span>
                                                                        <span className="language-tag">
                                                                            {ch.language}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className="setup-meta">
                                                            Tone: {setup.toneEnabled ? '✅ Enabled' : '❌ Disabled'}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="empty-config">
                                                <p>No translation setups configured yet.</p>
                                                <p className="config-hint">
                                                    Use the <code>/setup</code> or <code>/quicksetup</code> command in Discord to create a translation setup.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Dashboard;
