const Payment = require('../../models/Payment');

async function notifyAdminForPatreonSubmission(payment) {
    try {
        const client = global.discordClient;
        const adminUserId = process.env.ADMIN_NOTIFY_USER_ID;

        if (!client || !adminUserId) {
            return;
        }

        const submittedAt = payment?.createdAt ? new Date(payment.createdAt) : new Date();
        const timestampSeconds = Math.floor(submittedAt.getTime() / 1000);

        const embed = {
            color: 0x8b5cf6,
            title: '📥 Patreon Payment Details',
            description: 'A user submitted Patreon payment details from the pricing popup.',
            fields: [
                { name: 'Discord User', value: payment?.discordUsername || 'N/A', inline: true },
                { name: 'Server Name', value: payment?.discordServerName || 'N/A', inline: true },
                { name: 'Status', value: payment?.status || 'patreon', inline: true },
                { name: 'Plan', value: `${payment?.planName || 'Patreon'} (${payment?.planType || 'Monthly'})`, inline: true },
                { name: 'Price', value: payment?.price || 'N/A', inline: true },
                { name: 'Payment ID', value: payment?.paymentId || 'N/A', inline: true },
                { name: 'Submitted At', value: `<t:${timestampSeconds}:F>`, inline: false }
            ],
            timestamp: submittedAt.toISOString(),
            footer: { text: 'Air Translator • Admin Alert' }
        };

        const adminUser = await client.users.fetch(adminUserId);
        if (!adminUser) {
            return;
        }

        await adminUser.send({ embeds: [embed] }).catch(async () => {
            await adminUser.send(
                `📥 Patreon Payment Details\n` +
                `Discord User: ${payment?.discordUsername || 'N/A'}\n` +
                `Server Name: ${payment?.discordServerName || 'N/A'}\n` +
                `Status: ${payment?.status || 'patreon'}\n` +
                `Plan: ${payment?.planName || 'Patreon'} (${payment?.planType || 'Monthly'})\n` +
                `Price: ${payment?.price || 'N/A'}\n` +
                `Payment ID: ${payment?.paymentId || 'N/A'}\n` +
                `Submitted At: ${submittedAt.toISOString()}`
            );
        });
    } catch (error) {
        console.warn('Failed to notify admin for Patreon submission:', error?.message || error);
    }
}

/**
 * Parse POST data helper
 */
function parsePostData(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    const data = {};
                    for (const [key, value] of params) {
                        data[key] = value;
                    }
                    resolve(data);
                } else {
                    resolve({ body });
                }
            } catch {
                resolve({ body });
            }
        });
    });
}

/**
 * Get all payments with pagination and filtering
 */
async function getPayments(req, res) {
    try {
        const urlParts = new URL(req.url, `http://${req.headers.host}`);
        const page = parseInt(urlParts.searchParams.get('page')) || 1;
        const limit = parseInt(urlParts.searchParams.get('limit')) || 50;
        const status = urlParts.searchParams.get('status');
        const planType = urlParts.searchParams.get('planType');
        const search = urlParts.searchParams.get('search');

        const skip = (page - 1) * limit;
        
        // Build query
        const query = {};
        if (status) query.status = status;
        if (planType) query.planType = planType;
        if (search) {
            query.$or = [
                { discordUsername: { $regex: search, $options: 'i' } },
                { discordServerName: { $regex: search, $options: 'i' } }
            ];
        }

        const [payments, total] = await Promise.all([
            Payment.find(query)
                .sort({ paymentDate: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(query)
        ]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            payments,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        }));
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Get payment statistics
 */
async function getPaymentStats(req, res) {
    try {
        const [
            totalPayments,
            activeSubscriptions,
            activeTrials,
            monthlyRevenue,
            yearlyRevenue,
            recentPayments
        ] = await Promise.all([
            Payment.countDocuments({ status: { $in: ['completed', 'active', 'trial', 'pending', 'patreon'] } }),
            Payment.countDocuments({ status: 'active', planType: 'Monthly' }),
            Payment.countDocuments({ status: 'trial', isTrial: true }),
            Payment.countDocuments({ planType: 'Monthly', status: { $in: ['completed', 'active'] } }),
            Payment.countDocuments({ planType: 'Yearly', status: { $in: ['completed', 'active'] } }),
            Payment.find({ status: { $in: ['completed', 'active', 'trial', 'pending', 'patreon'] } })
                .sort({ paymentDate: -1 })
                .limit(10)
                .lean()
        ]);

        // Calculate estimated monthly revenue
        const estimatedRevenue = (monthlyRevenue * 5) + (yearlyRevenue * 50);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            stats: {
                totalPayments,
                activeSubscriptions,
                activeTrials,
                monthlyPlans: monthlyRevenue,
                yearlyPlans: yearlyRevenue,
                estimatedMonthlyRevenue: estimatedRevenue,
                recentPayments
            }
        }));
    } catch (error) {
        console.error('Error fetching payment stats:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Create a new payment record (webhook endpoint)
 */
async function createPayment(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;

        // Use provided payment ID or generate new one
        const paymentId = data.paymentId || `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const paymentData = {
            paymentId,
            discordServerName: data.serverName,
            discordUsername: data.username,
            planName: data.planName || 'Pro',
            planType: data.planType || 'Monthly',
            price: data.price || '$5',
            isTrial: data.isTrial || false,
            status: data.status || (data.isTrial ? 'trial' : 'pending'), // Use provided status or default to pending
            checkoutUrl: data.checkoutUrl || '',
            notes: data.notes || ''
        };

        // If trial, set trial end date (7 days from now)
        if (data.isTrial) {
            paymentData.trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        const payment = new Payment(paymentData);
        await payment.save();

        const isPatreonSubmission =
            paymentData.status === 'patreon' ||
            String(paymentData.planName || '').toLowerCase() === 'patreon' ||
            String(paymentData.checkoutUrl || '').toLowerCase().includes('patreon.com');

        if (isPatreonSubmission) {
            notifyAdminForPatreonSubmission(payment);
        }

        console.log(`✅ Payment record created: ${paymentId} - ${data.username} - ${data.planName} (${data.planType}) - Status: ${paymentData.status}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            payment
        }));
    } catch (error) {
        console.error('Error creating payment:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Update payment status
 */
async function updatePaymentStatus(req, res) {
    try {
        const postData = await parsePostData(req);
        const data = typeof postData === 'string' ? JSON.parse(postData) : postData;

        const payment = await Payment.findOneAndUpdate(
            { paymentId: data.paymentId },
            { 
                status: data.status,
                notes: data.notes || payment?.notes || ''
            },
            { new: true }
        );

        if (!payment) {
            console.log(`❌ Payment not found: ${data.paymentId}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Payment not found' }));
            return;
        }

        console.log(`✅ Payment updated: ${data.paymentId} - ${payment.discordUsername} - Status: ${data.status}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            payment
        }));
    } catch (error) {
        console.error('Error updating payment:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Delete a payment record
 */
async function deletePayment(req, res) {
    try {
        const urlParts = new URL(req.url, `http://${req.headers.host}`);
        const paymentId = urlParts.searchParams.get('paymentId');

        if (!paymentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Payment ID required' }));
            return;
        }

        const payment = await Payment.findOneAndDelete({ paymentId });

        if (!payment) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Payment not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'Payment deleted successfully'
        }));
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Create payment from parsed body data (for webhooks)
 */
async function createPaymentFromBody(data, res) {
    try {
        // Use provided payment ID or generate new one
        const paymentId = data.paymentId || `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const paymentData = {
            paymentId,
            discordServerName: data.serverName,
            discordUsername: data.username,
            planName: data.planName || 'Pro',
            planType: data.planType || 'Monthly',
            price: data.price || '$5',
            isTrial: data.isTrial || false,
            status: data.status || (data.isTrial ? 'trial' : 'pending'),
            checkoutUrl: data.checkoutUrl || '',
            notes: data.notes || ''
        };

        // If trial, set trial end date (7 days from now)
        if (data.isTrial) {
            paymentData.trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        const payment = new Payment(paymentData);
        await payment.save();

        const isPatreonSubmission =
            paymentData.status === 'patreon' ||
            String(paymentData.planName || '').toLowerCase() === 'patreon' ||
            String(paymentData.checkoutUrl || '').toLowerCase().includes('patreon.com');

        if (isPatreonSubmission) {
            notifyAdminForPatreonSubmission(payment);
        }

        console.log(`✅ Payment record created: ${paymentId} - ${data.username} - ${data.planName} (${data.planType}) - Status: ${paymentData.status}`);

        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            success: true,
            payment
        }));
    } catch (error) {
        console.error('Error creating payment:', error);
        res.writeHead(500, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

/**
 * Update payment status from parsed body data (for webhooks)
 */
async function updatePaymentStatusFromBody(data, res) {
    try {
        const payment = await Payment.findOneAndUpdate(
            { paymentId: data.paymentId },
            { 
                status: data.status,
                notes: data.notes || payment?.notes || ''
            },
            { new: true }
        );

        if (!payment) {
            console.log(`❌ Payment not found: ${data.paymentId}`);
            res.writeHead(404, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: 'Payment not found' }));
            return;
        }

        console.log(`✅ Payment updated: ${data.paymentId} - ${payment.discordUsername} - Status: ${data.status}`);

        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            success: true,
            payment
        }));
    } catch (error) {
        console.error('Error updating payment:', error);
        res.writeHead(500, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }
}

module.exports = {
    getPayments,
    getPaymentStats,
    createPayment,
    updatePaymentStatus,
    deletePayment,
    createPaymentFromBody,
    updatePaymentStatusFromBody,
    parsePostData
};
