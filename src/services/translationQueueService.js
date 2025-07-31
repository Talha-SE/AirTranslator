const PendingTranslation = require('../models/PendingTranslation');
const { translateText, translateTextToMultipleLanguages } = require('./mistralService');

class TranslationQueueService {
    constructor() {
        this.maxRetries = 3;
        this.apiKeys = [
            process.env.MISTRAL_API_KEY, // Primary API key
            process.env.MISTRAL_API_KEY_2 || 'hXtB0z74fQvRLlxJvaWKmOqX82DewIFQ' // Secondary API key
        ];
        this.currentApiIndex = 0;
    }

    /**
     * Adds a message to the translation queue
     * @param {Object} messageData - The message data to queue
     * @param {string} messageData.messageId - Discord message ID
     * @param {string} messageData.channelId - Discord channel ID
     * @param {string} messageData.serverId - Discord server ID
     * @param {string} messageData.content - Message content
     * @param {string} [messageData.sourceLanguage] - Detected source language
     * @param {string[]} [messageData.targetLanguages] - Target languages for translation
     * @returns {Promise<Object>} The queued message document
     */
    async queueMessage(messageData) {
        try {
            const queuedMessage = new PendingTranslation({
                messageId: messageData.messageId,
                channelId: messageData.channelId,
                serverId: messageData.serverId,
                content: messageData.content,
                sourceLanguage: messageData.sourceLanguage,
                targetLanguages: messageData.targetLanguages
            });

            return await queuedMessage.save();
        } catch (error) {
            console.error('Error queuing message:', error);
            throw error;
        }
    }

    /**
     * Processes pending translations
     * @param {Function} translator - Translation function (message, targetLanguage) => Promise<translation>
     */
    async processQueue(translator) {
        try {
            const pendingMessages = await PendingTranslation.find({
                status: { $in: ['pending', 'failed'] },
                attempts: { $lt: this.maxRetries }
            }).sort({ createdAt: 1 }).limit(10);

            for (const message of pendingMessages) {
                try {
                    message.status = 'processing';
                    message.attempts += 1;
                    message.lastAttemptAt = new Date();
                    await message.save();

                    // Process translations for each target language in parallel
                    const translationPromises = [];
                    const languagesPerApi = Math.ceil(message.targetLanguages.length / 2);
                    
                    // Split languages between two APIs
                    const api1Languages = message.targetLanguages.slice(0, languagesPerApi);
                    const api2Languages = message.targetLanguages.slice(languagesPerApi);
                    
                    if (api1Languages.length > 0) {
                        console.log(`Processing ${api1Languages.join(', ')} with API 1`);
                        translationPromises.push(
                            translateTextToMultipleLanguages(
                                message.content, 
                                api1Languages,
                                null, // auto-detect
                                null, // tone settings
                                this.apiKeys[0] // primary API
                            )
                        );
                    }
                    
                    if (api2Languages.length > 0) {
                        console.log(`Processing ${api2Languages.join(', ')} with API 2`);
                        translationPromises.push(
                            translateTextToMultipleLanguages(
                                message.content, 
                                api2Languages,
                                null, // auto-detect
                                null, // tone settings
                                this.apiKeys[1] // secondary API
                            )
                        );
                    }
                    
                    // Wait for all translations to complete
                    const results = await Promise.all(translationPromises);
                    const translations = Object.assign({}, ...results);
                    
                    // Process translations
                    for (const [language, translation] of Object.entries(translations)) {
                        if (translation && translation.length > 0) {
                            console.log(`✅ [API ${this.currentApiIndex}] Translated to ${language}`);
                            // TODO: Send translation to Discord
                            console.log(`Translated message ${message.messageId} to ${language}:`, translation);
                        }
                    }

                    message.status = 'completed';
                    await message.save();
                    console.log(`Completed processing message ${message.messageId}`);
                } catch (error) {
                    console.error(`❌ Error processing message ${message.messageId}:`, error);
                    message.status = 'failed';
                    await message.save();
                }
            }
            console.log('Finished processing batch');
        } catch (error) {
            console.error('❌ Error processing translation queue:', error);
        }
    }

    /**
     * Starts periodic queue processing
     * @param {Function} translator - Translation function
     * @param {number} [interval=30000] - Processing interval in ms (default: 30s)
     */
    startQueueProcessor(translator, interval = 30000) {
        console.log('Starting translation queue processor with interval:', interval, 'ms');
        console.log('Available API keys:', this.apiKeys.map(k => k ? '***' + k.slice(-4) : 'null'));
        this.queueInterval = setInterval(
            () => this.processQueue(translator),
            interval
        );
    }

    /**
     * Stops periodic queue processing
     */
    stopQueueProcessor() {
        if (this.queueInterval) {
            clearInterval(this.queueInterval);
        }
    }
}

module.exports = new TranslationQueueService();
