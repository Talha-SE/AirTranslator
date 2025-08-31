document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  document.querySelectorAll('button.btn[data-plan]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const planId = btn.getAttribute('data-plan');
      try {
        const res = await fetch('/api/payments/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to create session');
        window.location.href = data.paymentUrl;
      } catch (e) {
        alert(e.message);
      }
    });
  });
});
