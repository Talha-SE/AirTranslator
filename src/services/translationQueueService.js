const PendingTranslation = require('../models/PendingTranslation');
const { translateText, translateTextToMultipleLanguages } = require('./mistralService');

class TranslationQueueService {
    constructor() {
        this.maxRetries = 3;
        this.apiKeys = [
            process.env.MISTRAL_API_KEY, // Primary API key
            process.env.MISTRAL_API_KEY_2, // Secondary API key
            process.env.MISTRAL_API_KEY_3,
            process.env.MISTRAL_API_KEY_4,
            process.env.MISTRAL_API_KEY_5,
            process.env.MISTRAL_API_KEY_6
        ].filter(Boolean);
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

                    const activeApiKeys = this.apiKeys && this.apiKeys.length > 0
                        ? this.apiKeys
                        : [process.env.MISTRAL_API_KEY];

                    // Try each API key until one succeeds (single batch call for all languages)
                    let translations = {};
                    let lastError = null;
                    
                    for (let i = 0; i < activeApiKeys.length; i++) {
                        try {
                            console.log(`🔄 [Queue] Batch translating ${message.targetLanguages.length} languages using API ${i + 1}/${activeApiKeys.length}`);
                            
                            translations = await translateTextToMultipleLanguages(
                                message.content,
                                message.targetLanguages,
                                null, // auto-detect
                                null, // tone settings
                                activeApiKeys[i]
                            );
                            
                            console.log(`✅ [Queue] Success with API ${i + 1}: ${Object.keys(translations).length} translations`);
                            break; // Success, exit retry loop
                            
                        } catch (error) {
                            lastError = error;
                            const isLastKey = i === activeApiKeys.length - 1;
                            
                            if (!isLastKey) {
                                console.warn(`⚠️ [Queue] API ${i + 1} failed (${error?.message}), trying next...`);
                            } else {
                                console.error(`❌ [Queue] All API keys failed. Last error:`, error?.message);
                                throw error; // Re-throw on last attempt
                            }
                        }
                    }
                    
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
