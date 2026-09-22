const PendingTranslation = require('../models/PendingTranslation');
const { translateText, translateTextToMultipleLanguages } = require('./mistralService');

class TranslationQueueService {
    constructor() {
        this.maxRetries = 3;
        // Use NVIDIA API keys for translation (main model is now NVIDIA)
        // Fallback to Mistral keys if NVIDIA keys not set
        this.apiKeys = [
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_API_KEY
        ].filter(Boolean);
        
        // Fallback to Mistral keys if no NVIDIA keys configured
        if (this.apiKeys.length === 0) {
            this.apiKeys = [
                process.env.MISTRAL_API_KEY,
                process.env.MISTRAL_API_KEY_2,
                process.env.MISTRAL_API_KEY_3,
                process.env.MISTRAL_API_KEY_4,
                process.env.MISTRAL_API_KEY_5,
                process.env.MISTRAL_API_KEY_6
            ].filter(Boolean);
        }
        this.currentApiIndex = 0;
    }

    /**
     * Returns the next API key using round-robin rotation.
     * Each new request gets the next key in sequence, cycling back to the start.
     * Returns an array of all keys starting from the rotated index for failover.
     * @returns {string[]} Array of API keys, first one is the primary for this request
     */
    getNextApiKey() {
        const keys = this.apiKeys.length > 0 ? this.apiKeys : [process.env.MISTRAL_API_KEY];
        const start = this.currentApiIndex % keys.length;
        const primaryKeyNumber = (start + 1); // 1-based key number
        this.currentApiIndex = (this.currentApiIndex + 1) % keys.length;
        // Return keys starting from current index, wrapping around
        const rotated = [];
        for (let i = 0; i < keys.length; i++) {
            rotated.push(keys[(start + i) % keys.length]);
        }
        return { keys: rotated, keyIndex: primaryKeyNumber, totalKeys: keys.length };
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

                    // Round-robin: get rotated keys starting from next in sequence
                    const { keys: activeApiKeys, keyIndex, totalKeys } = this.getNextApiKey();

                    // Try each API key until one succeeds (single batch call for all languages)
                    let translations = {};
                    let lastError = null;
                    
                    for (let i = 0; i < activeApiKeys.length; i++) {
                        try {
                            const keySuffix = activeApiKeys[i] ? activeApiKeys[i].slice(-4) : 'undefined';
                            console.log(`🔄 [Queue] Batch translating ${message.targetLanguages.length} languages using Key ${keyIndex} of ${totalKeys} → ***${keySuffix}`);
                            
                            translations = await translateTextToMultipleLanguages(
                                message.content,
                                message.targetLanguages,
                                null, // auto-detect
                                null, // tone settings
                                activeApiKeys[i]
                            );
                            
                            console.log(`✅ [Queue] Success with Key ${keyIndex} of ${totalKeys} → ***${keySuffix}: ${Object.keys(translations).length} translations`);
                            break; // Success, exit retry loop
                            
                        } catch (error) {
                            lastError = error;
                            const isLastKey = i === activeApiKeys.length - 1;
                            
                            if (!isLastKey) {
                                const nextKeySuffix = activeApiKeys[i + 1] ? activeApiKeys[i + 1].slice(-4) : 'undefined';
                                console.warn(`⚠️ [Queue] Key ${keyIndex} of ${totalKeys} → ***${activeApiKeys[i].slice(-4)} failed (${error?.message}), trying next...`);
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
