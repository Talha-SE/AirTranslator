// Quick script to check payment records
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('./src/models/Payment');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('\n📊 Recent Payment Records:\n');
    
    const payments = await Payment.find()
        .sort({ paymentDate: -1 })
        .limit(10)
        .lean();
    
    if (payments.length === 0) {
        console.log('   No payments found yet.');
        console.log('   Try submitting the form on your pricing page!\n');
    } else {
        payments.forEach((p, i) => {
            console.log(`${i + 1}. ${p.paymentId}`);
            console.log(`   👤 User: ${p.discordUsername}`);
            console.log(`   🏠 Server: ${p.discordServerName}`);
            console.log(`   📦 Plan: ${p.planName} (${p.planType})`);
            console.log(`   💰 Price: ${p.price}`);
            console.log(`   📊 Status: ${p.status}`);
            console.log(`   📅 Date: ${new Date(p.paymentDate).toLocaleString()}`);
            console.log('');
        });
    }
    
    process.exit(0);
}).catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
