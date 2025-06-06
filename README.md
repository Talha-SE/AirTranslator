# Discord Translator Bot

A powerful Discord bot that provides real-time translation between multiple channels using Mistral AI. Perfect for international Discord communities!

## ✨ Features

- 🔄 **Real-time Translation**: Instantly translate messages between different channels
- 🌍 **Multiple Languages**: Support for any language supported by Mistral AI
- 🎭 **Tone Understanding**: Preserve tone, emotion, and cultural nuances in translations
- ⚙️ **Multiple Setups**: Create multiple translation setups per server
- 🎯 **Channel-specific**: Configure specific channels for each language
- 💾 **Persistent Storage**: Server configurations saved in MongoDB Atlas
- 🔒 **Secure**: Environment-based configuration for API keys

## 🚀 Commands

- `/setup` - Create a new translation setup
- `/quicksetup` - Fast setup for in-channel translations to multiple languages
- `/listsetups` - View all translation setups for the server
- `/addchannel` - Add a channel to an existing setup
- `/removechannel` - Remove a channel from a setup
- `/deletesetup` - Delete an entire translation setup
- `/toggletone` - Enable/disable tone understanding for better translations

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Discord Bot Token](https://discord.com/developers/applications)
- [MongoDB Atlas Account](https://www.mongodb.com/cloud/atlas)
- [Mistral AI API Key](https://mistral.ai/)

## 🛠️ Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/discord-translator-bot.git
   cd discord-translator-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create environment file:**
   Create a `.env` file in the root directory:
   ```env
   MISTRAL_API_KEY=your_mistral_api_key_here
   MONGODB_URI=your_mongodb_connection_string_here
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   ```

4. **Deploy slash commands:**
   ```bash
   npm run deploy
   ```

5. **Start the bot:**
   ```bash
   npm start
   ```

## 🔧 Configuration

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Enable the following bot permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands
   - View Channels
4. Enable "Message Content Intent" in the Bot section
5. Copy the bot token and client ID

### MongoDB Setup

1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Get your connection string
4. Replace `<password>` with your actual password

### Mistral AI Setup

1. Sign up at [Mistral AI](https://mistral.ai/)
2. Get your API key from the dashboard

## 📖 Usage Example

1. **Create a setup:**
   ```
   /setup name:English-Spanish channel1:#english channel2:#spanish language1:English language2:Spanish
   ```

2. **List all setups:**
   ```
   /listsetups
   ```

3. **Add more channels:**
   ```
   /addchannel setup:English-Spanish channel:#general language:English
   ```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Issues

If you encounter any issues, please [create an issue](https://github.com/yourusername/discord-translator-bot/issues) on GitHub.

## 🙏 Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API library
- [Mistral AI](https://mistral.ai/) - Translation API
- [MongoDB](https://www.mongodb.com/) - Database solution