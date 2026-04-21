const UNLIMITED_USAGE_OFFER_TEMPLATE = {
    title: '🚀 Unlimited Usage Offer',
    content: `Get the most out of our service by purchasing a **subscription** and enjoy **unlimited usage every month**.

🔒 **Secure payment via our official Patreon pricing page:**
https://www.patreon.com/c/tsio/membership

🎁 **Limited-Time Bonus:**
Subscribe now and claim a **FREE 7-day trial** (limited-time offer):
https://www.patreon.com/c/tsio/membership

✨ **Note:** If you’ve already subscribed, you can start using the service immediately.`.trim(),
    color: '#f59e0b'
};

function getUnlimitedUsageOfferTemplate() {
    return {
        ...UNLIMITED_USAGE_OFFER_TEMPLATE
    };
}

module.exports = {
    UNLIMITED_USAGE_OFFER_TEMPLATE,
    getUnlimitedUsageOfferTemplate
};
