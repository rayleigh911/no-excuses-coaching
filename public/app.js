/**
 * Apex Elite — Frontend Application
 * Real Stripe Checkout integration (no simulator)
 * Plans are fetched from the backend /api/plans
 */

const API_BASE = window.location.origin;

let stripeInstance = null;
let stripeElements = null;
let activePlanId = null;
let turnstileToken = null;
let stripeElementsReady = false;

// ─── Cloudflare Turnstile Callbacks (called globally by Turnstile script) ─────
window.onTurnstileSuccess = function(token) {
  turnstileToken = token;
  // Enable pay button if Stripe elements are also ready
  if (stripeElementsReady) {
    const payBtn = document.getElementById('pay-btn');
    const payBtnText = document.getElementById('pay-btn-text');
    payBtn.disabled = false;
    payBtnText.textContent = 'Pay Now — Verified ✓';
  }
};

window.onTurnstileExpired = function() {
  turnstileToken = null;
  const payBtn = document.getElementById('pay-btn');
  const payBtnText = document.getElementById('pay-btn-text');
  payBtn.disabled = true;
  payBtnText.textContent = 'Verification Expired — Retry';
};

window.onTurnstileError = function() {
  turnstileToken = null;
  const errorDiv = document.getElementById('payment-error');
  errorDiv.textContent = 'Bot verification failed. Please refresh and try again.';
  errorDiv.style.display = 'block';
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initSubscriptionState();
  initWorkoutGenerator();
  initMacroCalculator();
  initMachineGuide();
  loadAndRenderPlans();   // fetch real plans from server
  setupNavHighlight();
  await initStripe();
  setupCheckoutModal();
});

async function initStripe() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const { publishableKey } = await res.json();
    if (publishableKey) {
      stripeInstance = Stripe(publishableKey);
    }
  } catch (err) {
    console.error("Failed to initialize Stripe:", err);
  }
}


// ─── State Management ────────────────────────────────────────────────────────
const appState = {
  isPremiumUnlocked: false,
  unlockedPlans: [],
  workout: { goal: 'gain', level: 'intermediate', equip: 'gym' },
};

// Premium extensions that get injected when unlocked
const premiumWorkoutsDatabase = {
  gain: {
    beginner: {
      home: { name: 'DB Bulgarian Split Squat (1.5 Reps)', sets: '3 Sets x 8 Reps', rest: '45s Rest', tip: 'Perform a half rep at the bottom to increase tension.' },
      gym: { name: 'Pec Deck Fly (Drop Set Technique)', sets: '3 Sets x 8+8 Reps', rest: '60s Rest', tip: 'Double drop set: drop weight 30% after 8 reps and push to failure.' }
    },
    intermediate: {
      home: { name: 'Weighted Deficit Push-Ups + DB Rows', sets: '4 Sets x 12 Reps (Superset)', rest: '45s Rest', tip: 'No rest between exercises. Perform with extreme mechanical control.' },
      gym: { name: 'Lying Leg Curl (Myo-Reps Technique)', sets: '4 Sets x 12 (+4+4+4+4)', rest: '15s Rest', tip: 'Activate target, rest-pause 5 times with 4 deep breaths in between.' }
    }
  },
  cut: {
    beginner: {
      home: { name: '10-Minute Tabata Core Annihilation', sets: '4 Cycles x 20s Work/10s Rest', rest: 'No Rest', tip: 'Plank jacks, bicycle crunches, V-ups in rapid succession.' },
      gym: { name: 'Assault Bike Tabata Protocol', sets: '8 Rounds x 20s Max Sprint', rest: '10s Rest', tip: 'Generate absolute max wattage. Keep posture upright.' }
    },
    intermediate: {
      home: { name: 'Dumbbell Devil Press', sets: '4 Sets x 10 Reps (Finisher)', rest: '45s Rest', tip: 'Combination chest burpee to double DB ground-to-overhead swing.' },
      gym: { name: 'Lying Leg Press (Rest-Pause Giant Sets)', sets: '4 Sets x 20 Reps', rest: '30s Rest', tip: 'Perform 10 reps, rest 10s, perform 5, rest 10s, perform 5. Burnout!' }
    }
  },
  health: {
    beginner: {
      home: { name: 'Active Recovery & Mobility Flow', sets: '1×15 min', rest: '—', tip: 'SMR rolling, 90/90 hip transitions, thoracic extensions.' },
      gym: { name: 'Full-Body Structural Integration', sets: '3×10', rest: '60s', tip: 'Turkish get-ups with light kettlebell, focus on shoulder stability.' }
    },
    intermediate: {
      home: { name: 'EMOM Kettlebell/DB Conditioning', sets: '12 min', rest: '—', tip: 'Every minute on the minute: 10 swings + 5 goblet squats. Rest remainder of minute.' },
      gym: { name: 'Peak Aerobic Threshold Training', sets: '4×4 min', rest: '2 min', tip: 'Assault bike or rower at 85% HRmax, active recovery during rest.' }
    }
  }
};

function initSubscriptionState() {
  const savedSub = localStorage.getItem('no_excuses_premium');
  if (savedSub) {
    try {
      const data = JSON.parse(savedSub);
      appState.isPremiumUnlocked = data.isPremiumUnlocked || false;
      appState.unlockedPlans = data.unlockedPlans || [];
    } catch (e) {
      console.error('Error loading subscription state', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRIPE CHECKOUT — fetch plans & redirect to Stripe-hosted checkout
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAndRenderPlans() {
  const grid = document.getElementById('pricing-grid');

  try {
    const res   = await fetch(`${API_BASE}/api/plans`);
    const plans = await res.json();
    renderPricingCards(plans);
  } catch (err) {
    grid.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <i class="fas fa-server" style="font-size:2.5rem;margin-bottom:15px;color:var(--accent-orange);"></i>
        <h3 style="color:#fff;margin-bottom:8px;">Server Offline</h3>
        <p>Run <code style="background:rgba(255,255,255,.08);padding:2px 8px;border-radius:4px;">npm start</code> in the project folder, then refresh.</p>
      </div>`;
  }
}

function renderPricingCards(plans) {
  const grid = document.getElementById('pricing-grid');
  grid.innerHTML = '';

  // Tag the recommended plan (index 2 = elite monthly)
  const recommendedId = 'elite';

  plans.forEach((plan, i) => {
    const isRecommended = plan.id === recommendedId;
    // Check if the user bought this specific plan, or if they have VIP (VIP unlocks everything)
    const isOwned = appState.unlockedPlans.includes(plan.id) || appState.unlockedPlans.includes('vip');
    const priceFormatted = (plan.price / 100).toFixed(0);
    const priceSuffix    = plan.mode === 'subscription' ? '/mo' : ' one-time';

    const featuresHtml = plan.features
      .map(f => `<li><i class="fas fa-check"></i> ${f}</li>`)
      .join('');

    const badgeHtml = isRecommended
      ? `<div class="plan-recommended-badge">MOST POPULAR</div>`
      : '';

    const modeBadgeHtml = plan.mode === 'subscription'
      ? `<span class="mode-badge subscription"><i class="fas fa-rotate"></i> Monthly</span>`
      : `<span class="mode-badge one-time"><i class="fas fa-bolt"></i> One-Time</span>`;

    const card = document.createElement('div');
    card.className = `pricing-card glass-panel${isRecommended ? ' recommended' : ''}${isOwned ? ' owned' : ''}`;
    card.dataset.planId = plan.id;

    const btnLabel = isOwned ? 'Program Unlocked' : `Get ${plan.name}`;
    const btnIcon  = isOwned ? 'fas fa-check-circle' : 'fas fa-lock-open';

    card.innerHTML = `
      ${badgeHtml}
      <div class="price-hdr">
        ${modeBadgeHtml}
        <h3>${plan.name}</h3>
        <p class="plan-desc">${plan.description}</p>
        <div class="price-num">$${priceFormatted}<span>${priceSuffix}</span></div>
      </div>
      <ul class="price-features">${featuresHtml}</ul>
      <button class="buy-plan-btn ${isRecommended ? 'btn-primary' : 'btn-secondary'}"
              data-plan-id="${plan.id}"
              ${isOwned ? 'disabled' : ''}
              style="justify-content:center;width:100%;">
        <i class="${btnIcon}"></i>
        <span class="btn-label">${btnLabel}</span>
      </button>
      <div class="stripe-secure-note">
        <i class="fab fa-stripe" style="color:#635bff;font-size:1rem;"></i>
        Secured by Stripe — 256-bit SSL
      </div>
    `;

    grid.appendChild(card);
  });

  // Attach checkout handlers for non-owned plans
  document.querySelectorAll('.buy-plan-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const planId = btn.dataset.planId;
      const planCard = btn.closest('.pricing-card');
      const planName = planCard.querySelector('h3').textContent;
      openCheckoutModal(planId, planName);
    });
  });
}

function openCheckoutModal(planId, planName) {
  const modal = document.getElementById('checkout-modal');
  const modalPlanName = document.getElementById('modal-plan-name');
  const emailInput = document.getElementById('checkout-email');
  
  activePlanId = planId;
  modalPlanName.textContent = planName;
  emailInput.value = '';
  
  modal.classList.add('show');
}

function setupCheckoutModal() {
  const modal = document.getElementById('checkout-modal');
  const closeBtn = document.getElementById('close-modal-btn');
  const emailInput = document.getElementById('checkout-email');
  const payBtn = document.getElementById('pay-btn');
  const payBtnText = document.getElementById('pay-btn-text');
  const errorDiv = document.getElementById('payment-error');
  const paymentElementContainer = document.getElementById('payment-element-container');

  // Close modal logic
  closeBtn.addEventListener('click', hideModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideModal();
  });

  function hideModal() {
    modal.classList.remove('show');
    stripeElements = null;
    stripeElementsReady = false;
    turnstileToken = null;
    document.getElementById('payment-element').innerHTML = '';
    paymentElementContainer.style.display = 'none';
    // Reset Turnstile widget
    const turnstileContainer = document.getElementById('turnstile-container');
    turnstileContainer.style.display = 'none';
    if (window.turnstile) {
      window.turnstile.reset('#cf-turnstile-widget');
    }
    emailInput.disabled = false;
    payBtn.disabled = true;
    payBtnText.textContent = 'Initialize Payment';
    errorDiv.style.display = 'none';
  }

  // Handle pay button click
  payBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!stripeInstance || !stripeElements) return;

    // Double-check Turnstile token
    if (!turnstileToken) {
      const errorDiv = document.getElementById('payment-error');
      errorDiv.textContent = 'Please complete the bot verification check above.';
      errorDiv.style.display = 'block';
      return;
    }

    payBtn.disabled = true;
    payBtnText.textContent = 'Processing Payment...';
    errorDiv.style.display = 'none';

    try {
      const { error } = await stripeInstance.confirmPayment({
        elements: stripeElements,
        confirmParams: {
          return_url: `${window.location.origin}/success.html?plan=${activePlanId}`,
        },
      });

      if (error) {
        throw new Error(error.message);
      }
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
      payBtn.disabled = false;
      payBtnText.textContent = 'Pay Now';
      // Reset Turnstile on error so user can re-verify
      turnstileToken = null;
      stripeElementsReady = false;
      if (window.turnstile) window.turnstile.reset('#cf-turnstile-widget');
    }
  });

  // Handle email changes to dynamically create PaymentIntent and mount Elements
  let debounceTimer;
  emailInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const email = emailInput.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(email)) {
        payBtn.disabled = true;
        payBtnText.textContent = 'Enter Valid Email';
        return;
      }

      payBtnText.textContent = 'Initializing Secure Checkout...';
      emailInput.disabled = true;

      try {
        const res = await fetch(`${API_BASE}/api/create-payment-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: activePlanId, email, turnstileToken }),
        });
        const data = await res.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const { clientSecret } = data;

        const appearance = {
          theme: 'night',
          variables: {
            colorPrimary: '#ff5722',
            colorBackground: '#13151b',
            colorText: '#ffffff',
            colorDanger: '#ff5722',
            fontFamily: 'Inter, system-ui, sans-serif',
            spacingUnit: '4px',
            borderRadius: '4px',
          },
        };

        stripeElements = stripeInstance.elements({ clientSecret, appearance });
        const paymentElement = stripeElements.create('payment');
        
        paymentElementContainer.style.display = 'block';
        paymentElement.mount('#payment-element');

        paymentElement.on('ready', () => {
          stripeElementsReady = true;
          // Show Turnstile widget — Pay button activates only after both are done
          const turnstileContainer = document.getElementById('turnstile-container');
          turnstileContainer.style.display = 'block';
          payBtnText.textContent = 'Complete Verification Below';
          // If Turnstile already passed (fast machines), enable pay button
          if (turnstileToken) {
            payBtn.disabled = false;
            payBtnText.textContent = 'Pay Now — Verified ✓';
          }
        });

      } catch (err) {
        errorDiv.textContent = `Initialization failed: ${err.message}`;
        errorDiv.style.display = 'block';
        emailInput.disabled = false;
        payBtnText.textContent = 'Initialize Payment';
      }
    }, 600);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKOUT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

const workoutsDatabase = {
  gain: {
    beginner: {
      home: [
        { name: 'Dumbbell Goblet Squats',        sets: '3×10', rest: '60s', tip: 'Hold DB vertical at chest, drive knees out.' },
        { name: 'Dumbbell Floor Press',           sets: '3×12', rest: '60s', tip: 'Press DBs up, keep elbows at 45°.' },
        { name: 'Single-Arm Dumbbell Row',        sets: '3×10 /side', rest: '45s', tip: 'Pull elbow back to hip, flat spine.' },
        { name: 'DB Overhead Press (Seated)',     sets: '3×10', rest: '60s', tip: 'Brace core, press straight up.' },
        { name: '🔒 Premium Hypertrophy Finisher', sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Leg Press Machine',              sets: '3×10', rest: '90s', tip: 'Feet flat, don\'t lock knees at top.' },
        { name: 'Machine Chest Press',            sets: '3×10', rest: '60s', tip: 'Handles align with mid-chest.' },
        { name: 'Lat Pulldown Machine',           sets: '3×12', rest: '60s', tip: 'Pull to upper chest, squeeze blades.' },
        { name: 'Standing Cable Bicep Curls',     sets: '3×12', rest: '45s', tip: 'Elbows tucked, slow control.' },
        { name: '🔒 Premium Machine Routine',      sets: '—', rest: '—', isPremium: true },
      ],
    },
    intermediate: {
      home: [
        { name: 'Bulgarian Split Squats (DBs)',   sets: '4×8 /leg', rest: '60s', tip: 'Rear foot elevated, chest high.' },
        { name: 'Weighted Push-Ups',              sets: '4×12', rest: '60s', tip: 'Weight on upper back, control tempo.' },
        { name: 'DB Romanian Deadlifts',          sets: '4×10', rest: '60s', tip: 'Hinge at hips, keep DBs close to shins.' },
        { name: 'DB Lateral Raises',              sets: '3×15', rest: '45s', tip: 'Lead with elbows, slight forward lean.' },
        { name: '🔒 Elite Beast-Mode Finisher',    sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Barbell Back Squat',             sets: '4×8',  rest: '120s', tip: 'Hips below parallel, drive through heels.' },
        { name: 'Barbell Bench Press',            sets: '4×8',  rest: '90s',  tip: 'Touch mid-chest, plant feet firmly.' },
        { name: 'Seated Cable Row (Wide Grip)',   sets: '4×10', rest: '60s',  tip: 'Pull to lower abdomen, expand chest.' },
        { name: 'Dumbbell Hammer Curls',          sets: '3×12', rest: '60s',  tip: 'Neutral grip, 3s lowering phase.' },
        { name: '🔒 Premium Heavy Machine Block',  sets: '—', rest: '—', isPremium: true },
      ],
    },
  },
  cut: {
    beginner: {
      home: [
        { name: 'Bodyweight Air Squats',          sets: '3×20', rest: '45s', tip: 'High tempo, squeeze glutes at top.' },
        { name: 'Decline Push-Ups',               sets: '3×10', rest: '45s', tip: 'Feet on bed, straight plank line.' },
        { name: 'DB Renegade Rows',               sets: '3×12', rest: '45s', tip: 'Pull to rib cage, don\'t twist hips.' },
        { name: 'Jumping Jacks',                  sets: '3×45s', rest: '30s', tip: 'Constant movement, soft landings.' },
        { name: '🔒 Premium Sweat Circuit',        sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Smith Machine Incline Press',    sets: '3×12', rest: '60s', tip: '30° incline, bar to collarbone.' },
        { name: 'Leg Press (High Foot Position)', sets: '3×15', rest: '60s', tip: 'Push through heels for glutes.' },
        { name: 'Cable Face Pulls',               sets: '3×15', rest: '45s', tip: 'Pull toward nose, flare elbows wide.' },
        { name: 'Stairmaster Intervals',          sets: '15 min', rest: 'Steady', tip: 'Keep pace, don\'t lean on handles.' },
        { name: '🔒 Metabolic Machine Routine',    sets: '—', rest: '—', isPremium: true },
      ],
    },
    intermediate: {
      home: [
        { name: 'DB Thrusters (Squat to Press)',  sets: '4×12', rest: '45s', tip: 'Explosive drive from squat bottom into overhead press.' },
        { name: 'Chin-Ups (Bodyweight)',          sets: '4×Max', rest: '60s', tip: 'Full extension, chin over bar.' },
        { name: 'DB Walking Lunges',              sets: '3×20 steps', rest: '45s', tip: 'Control knee landing, core tight.' },
        { name: 'Burpees',                        sets: '3×15', rest: '30s', tip: 'Full chest to floor, jump at top.' },
        { name: '🔒 Calorie-Crush Protocol',       sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Barbell Romanian Deadlifts',     sets: '4×10', rest: '60s', tip: 'Bar touching shins, hinge hips back.' },
        { name: 'DB Incline Chest Press',         sets: '4×10', rest: '60s', tip: 'Press weights together at peak.' },
        { name: 'Cable Lat Pullover',             sets: '3×12', rest: '45s', tip: 'Hinge slightly, sweep cable to thighs.' },
        { name: 'Rowing Machine Sprints',         sets: '8×200m', rest: '40s', tip: 'Drive hard with legs, pull to chest.' },
        { name: '🔒 High-Octane Metabolic Circuit', sets: '—', rest: '—', isPremium: true },
      ],
    },
  },
  health: {
    beginner: {
      home: [
        { name: 'Bodyweight Squats',              sets: '3×15', rest: '60s', tip: 'Focus on mobility, full depth.' },
        { name: 'Push-Ups (Knee or Full)',        sets: '3×10', rest: '60s', tip: 'Straight line from head to toes.' },
        { name: 'Superman Hold',                  sets: '3×30s', rest: '30s', tip: 'Squeeze glutes and upper back at peak.' },
        { name: '10-min Brisk Walk / Jog',        sets: '1×10 min', rest: '—', tip: 'Stay in light aerobic zone.' },
        { name: '🔒 Mobility & Recovery Protocol', sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Elliptical Warm-Up',             sets: '10 min', rest: '—',  tip: 'Low resistance, full stride.' },
        { name: 'Cable Machine Core Rotations',   sets: '3×15', rest: '45s', tip: 'Controlled slow rotation, brace core.' },
        { name: 'Seated Row (Light Weight)',       sets: '3×15', rest: '60s', tip: 'Focus on posture and technique.' },
        { name: 'Treadmill Incline Walk',          sets: '15 min', rest: '—', tip: '10% incline, 5 km/h pace.' },
        { name: '🔒 Longevity & Performance Plan', sets: '—', rest: '—', isPremium: true },
      ],
    },
    intermediate: {
      home: [
        { name: 'Jump Rope Intervals',            sets: '5×1 min', rest: '30s', tip: 'Alternate feet, fast cadence.' },
        { name: 'DB Deadlifts',                   sets: '3×12', rest: '60s',   tip: 'Hip hinge focus, flat back throughout.' },
        { name: 'Pike Push-Ups',                  sets: '3×10', rest: '60s',   tip: 'Inverted V position, lower head to floor.' },
        { name: 'Hollow Body Hold',               sets: '3×30s', rest: '30s',  tip: 'Press lower back to floor, arms and legs extended.' },
        { name: '🔒 Athletic Conditioning Block',  sets: '—', rest: '—', isPremium: true },
      ],
      gym: [
        { name: 'Assault Bike Warm-Up',           sets: '5 min', rest: '—',   tip: 'Easy pace, get blood moving.' },
        { name: 'Trap Bar Deadlift',              sets: '4×8',   rest: '90s', tip: 'Neutral spine, drive through heels.' },
        { name: 'Dip Machine',                    sets: '3×12',  rest: '60s', tip: 'Full ROM, slight forward lean.' },
        { name: 'Battle Ropes (Alternating)',     sets: '4×30s', rest: '30s', tip: 'Keep hips low, full arm extension.' },
        { name: '🔒 Peak Performance Circuit',     sets: '—', rest: '—', isPremium: true },
      ],
    },
  },
};

function initWorkoutGenerator() {
  document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      const parent   = card.closest('.option-cards');
      parent.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.workout[parent.dataset.category] = card.dataset.value;
      generateWorkout();
    });
  });

  document.getElementById('generate-workout-btn')
    ?.addEventListener('click', generateWorkout);

  generateWorkout();
}

function generateWorkout() {
  const { goal, level, equip } = appState.workout;
  const box = document.getElementById('workout-result-box');
  box.innerHTML = '';

  const lvl  = level === 'advanced' ? 'intermediate' : level;
  const routine = workoutsDatabase[goal]?.[lvl]?.[equip];

  if (!routine) {
    box.innerHTML = `<div class="results-placeholder"><i class="fas fa-exclamation-triangle"></i><h3>No routine found</h3><p>Try another combination.</p></div>`;
    return;
  }

  const goalLabels = { gain: 'Mass Gain & Hypertrophy', cut: 'Fat Loss & HIIT', health: 'Conditioning & Mobility' };
  const levelLabel = level === 'beginner' ? 'Foundation' : level === 'intermediate' ? 'Hardcore Split' : 'Elite Protocol';

  const plan = document.createElement('div');
  plan.className = 'workout-plan';
  plan.style.display = 'block';
  plan.innerHTML = `
    <div class="workout-header">
      <div>
        <h3>${levelLabel} — ${goalLabels[goal] || goal}</h3>
        <p>${equip === 'gym' ? 'Commercial Gym Machine Setup' : 'Minimal Equipment / Home Setup'}</p>
      </div>
      <span class="badge-info">${level}</span>
    </div>
    <div class="exercise-list" id="ex-list"></div>`;
  box.appendChild(plan);

  const list = plan.querySelector('#ex-list');
  routine.forEach(ex => {
    const item = document.createElement('div');
    item.className = 'exercise-item';

    if (ex.isPremium) {
      if (appState.isPremiumUnlocked) {
        const premiumEx = premiumWorkoutsDatabase[goal]?.[lvl]?.[equip];
        if (premiumEx) {
          item.innerHTML = `
            <div class="exercise-info">
              <span class="badge-info" style="background: rgba(255, 87, 34, 0.1); border-color: var(--accent-orange); color: var(--accent-orange); font-size:0.65rem; margin-bottom:4px; display:inline-block;"><i class="fas fa-unlock"></i> Premium Unlocked</span>
              <h4>${premiumEx.name}</h4>
              <p>${premiumEx.tip}</p>
            </div>
            <div class="exercise-stats">
              <span class="exercise-sets" style="color: var(--accent-cyan);">${premiumEx.sets}</span>
              <span class="exercise-rest">${premiumEx.rest}</span>
            </div>
          `;
        } else {
          item.innerHTML = `
            <div class="exercise-info">
              <h4>${ex.name} (Unlocked)</h4>
              <p>You have unlocked premium content.</p>
            </div>
            <div class="exercise-stats">
              <span class="exercise-sets">Unlocked</span>
              <span class="exercise-rest">Complete</span>
            </div>`;
        }
      } else {
        item.style.cssText = 'border:1px dashed rgba(255,87,34,.4);background:rgba(255,87,34,.02);cursor:pointer;';
        item.innerHTML = `
          <div class="exercise-info">
            <h4 style="color:var(--accent-orange);"><i class="fas fa-lock" style="margin-right:8px;"></i> ${ex.name}</h4>
            <p>Upgrade to a premium plan to unlock this elite finisher.</p>
          </div>
          <div class="exercise-stats">
            <span class="exercise-sets" style="opacity:.5;">[LOCKED]</span>
            <span class="exercise-rest">↓ Upgrade Below</span>
          </div>`;
        item.addEventListener('click', () =>
          document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' }));
      }
    } else {
      item.innerHTML = `
        <div class="exercise-info"><h4>${ex.name}</h4><p>${ex.tip}</p></div>
        <div class="exercise-stats">
          <span class="exercise-sets">${ex.sets}</span>
          <span class="exercise-rest">${ex.rest}</span>
        </div>`;
    }
    list.appendChild(item);
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// NUTRITION CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

function initMacroCalculator() {
  document.getElementById('macro-form')
    ?.addEventListener('submit', e => { e.preventDefault(); calculateMacros(); });
  calculateMacros();
}

function calculateMacros() {
  const w  = parseFloat(document.getElementById('weight').value);
  const h  = parseFloat(document.getElementById('height').value);
  const a  = parseInt(document.getElementById('age').value, 10);
  const g  = document.getElementById('gender').value;
  const ac = parseFloat(document.getElementById('activity').value);
  const gv = document.getElementById('macro-goal').value;

  const bmr  = g === 'male'
    ? (10 * w) + (6.25 * h) - (5 * a) + 5
    : (10 * w) + (6.25 * h) - (5 * a) - 161;
  const tdee = Math.round(bmr * ac);

  let cals = tdee, pr = .30, cr = .40, fr = .30;
  if      (gv === 'aggressive-cut') { cals = tdee - 500; pr = .40; cr = .30; fr = .30; }
  else if (gv === 'fat-loss')       { cals = tdee - 300; pr = .35; cr = .35; fr = .30; }
  else if (gv === 'muscle-gain')    { cals = tdee + 300; pr = .30; cr = .45; fr = .25; }

  document.getElementById('calories-num').textContent = cals;
  document.getElementById('protein-val').textContent  = `${Math.round(cals*pr/4)}g (${Math.round(pr*100)}%)`;
  document.getElementById('carb-val').textContent     = `${Math.round(cals*cr/4)}g (${Math.round(cr*100)}%)`;
  document.getElementById('fat-val').textContent      = `${Math.round(cals*fr/9)}g (${Math.round(fr*100)}%)`;

  document.getElementById('protein-fill').style.width = `${pr*100}%`;
  document.getElementById('carb-fill').style.width    = `${cr*100}%`;
  document.getElementById('fat-fill').style.width     = `${fr*100}%`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GYM MACHINE GUIDE
// ═══════════════════════════════════════════════════════════════════════════════

const machinesDatabase = [
  {
    id: 'lat-pulldown', name: 'Lat Pulldown Machine', category: 'Back',
    desc: 'Isolates the latissimus dorsi, building a wide, V-tapered back. Best machine for pull-up beginners.',
    tips: ['Limit lean-back angle to 10-15°.', 'Pull bar to collarbone, not stomach.', 'Squeeze shoulder blades at the bottom.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M4 3h16M12 3v5M7 8h10M6 8v13m12-13v13M9 13h6"/></svg>`,
  },
  {
    id: 'leg-press', name: 'Horizontal Leg Press', category: 'Legs',
    desc: 'Heavy quad, hamstring, and glute loading without spinal compression. Best machine for leg mass.',
    tips: ['Feet flat — heels in = quads, heels out = glutes.', 'Never lock knees at the top.', 'Lower until knees reach 90°.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M3 21h18M5 17l6-6m2-2l3-3M8 10h8"/></svg>`,
  },
  {
    id: 'chest-press', name: 'Incline Chest Press Machine', category: 'Chest',
    desc: 'Targets upper pectorals safely. Ideal for those learning to bench or rehabbing shoulders.',
    tips: ['Set seat so handles align with upper chest.', 'Retract shoulders into pad before pressing.', 'Control the return stroke — 2 seconds.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M3 5h18M6 5v14M18 5v14M8 12h8"/></svg>`,
  },
  {
    id: 'cable-crossover', name: 'Cable Crossover', category: 'Chest',
    desc: 'Maintains constant horizontal tension across the full chest ROM — superior to dumbbells for isolation.',
    tips: ['High pulleys = lower chest, low pulleys = upper chest.', 'Slight elbow bend — fly, do not press.', 'Slightly cross hands at peak contraction.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M12 4v16M4 8h16M4 16h16"/></svg>`,
  },
  {
    id: 'cable-row', name: 'Seated Cable Row', category: 'Back',
    desc: 'Builds thickness in the mid-back, traps and rhomboids. A staple for a dense, powerful back.',
    tips: ['Sit upright — don\'t rock fore and aft.', 'Initiate with scapular retraction, not arms.', 'Slow controlled release — feel the stretch.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M4 12h16M6 6h12M12 6v12"/></svg>`,
  },
  {
    id: 'leg-curl', name: 'Lying Leg Curl', category: 'Legs',
    desc: 'Isolates the hamstrings through knee flexion. Critical for injury prevention and hamstring balance.',
    tips: ['Align knee joint with the machine pivot axis.', 'Keep hips pressed flat on the bench throughout.', 'Squeeze hard at top, resist weight for 2s on descent.'],
    svg: `<svg class="machine-icon-svg" viewBox="0 0 24 24"><path d="M3 19h18M5 19v-6a5 5 0 0 1 10 0v6M10 8h4"/></svg>`,
  },
];

function initMachineGuide() {
  const grid   = document.getElementById('machine-grid');
  const search = document.getElementById('machine-search');
  const tags   = document.querySelectorAll('.filter-tag');
  if (!grid) return;

  let cat   = 'all';
  let query = '';

  function render() {
    grid.innerHTML = '';
    const filtered = machinesDatabase.filter(m =>
      (cat === 'all' || m.category.toLowerCase() === cat) &&
      (m.name.toLowerCase().includes(query) || m.desc.toLowerCase().includes(query))
    );

    if (!filtered.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
        <i class="fas fa-search" style="font-size:2rem;margin-bottom:12px;"></i><p>No machines match.</p></div>`;
      return;
    }

    filtered.forEach(m => {
      const card = document.createElement('div');
      card.className = 'machine-card';
      card.style.animation = 'fadeIn .3s ease-out forwards';
      card.innerHTML = `
        <div class="machine-media">
          <span class="machine-category">${m.category}</span>
          ${m.svg}
        </div>
        <div class="machine-info">
          <h3>${m.name}</h3>
          <p>${m.desc}</p>
          <div class="machine-tips">
            <h4>COACH SETUP &amp; TIPS</h4>
            <ul>${m.tips.map(t => `<li><i class="fas fa-caret-right"></i><span>${t}</span></li>`).join('')}</ul>
          </div>
        </div>`;
      grid.appendChild(card);
    });
  }

  search?.addEventListener('input', e => { query = e.target.value.toLowerCase().trim(); render(); });
  tags.forEach(t => t.addEventListener('click', () => {
    tags.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    cat = t.dataset.category;
    render();
  }));

  render();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
    <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAV HIGHLIGHT
// ═══════════════════════════════════════════════════════════════════════════════

function setupNavHighlight() {
  const sections = document.querySelectorAll('section[id], header[id]');
  const links    = document.querySelectorAll('.nav-links a');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${e.target.id}`));
      }
    });
  }, { threshold: 0.4 });

  sections.forEach(s => observer.observe(s));
}
