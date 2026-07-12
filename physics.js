// Constants
const g = 9.81; // gravity
const kinVisc = 1.0e-6; // kinematic viscosity of water

function calculateWaveForces(params) {
    // Wave parameters
    const omega = (2 * Math.PI) / params.T; // angular frequency
    const k = solveDispersion(omega, params.h); // wave number
    const wavelength = (2 * Math.PI) / k;

    // Amplitude
    const a = params.H / 2;

    // Depth parameter
    const kh = k * params.h;

    // Wave-related parameters
    const U_m = (a * omega) / Math.sinh(kh); // max particle velocity
    const A_m = (a * omega * omega) / Math.sinh(kh); // max particle acceleration
    const KC = U_m * params.T / params.D; // Keulegan-Carpenter number

    // Cylinder-related parameters
    const ka = k * params.D / 2; // MacCamy-Fuchs parameter
    const A = Math.PI * params.D * params.D / 4; // cross-sectional area
    const Re = U_m * params.D / kinVisc; // Reynolds number

    // MacCamy-Fuchs diffraction correction
    let correctionFactor = 1.0;
    if (params.useMacCamy && ka < 5) {
        correctionFactor = macCamyFuchsCorrection(ka, KC);
    }

    // Adjust coefficients
    const Cd_corrected = params.Cd * correctionFactor;
    const Cm_corrected = params.Cm * correctionFactor;

    // Time series calculation
    const numPoints = 200;
    const timeData = [];
    let peakWaveForce = 0;
    let peakAirForce = 0;

    for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * params.T;
        const phase = omega * t;

        // Wave particle velocity and acceleration at the cylinder
        const z = -params.d / 2; // depth at cylinder center
        const kz = k * z;

        const velocity = U_m * Math.cos(phase) * (Math.cosh(kz) / Math.sinh(kh));
        const acceleration = A_m * Math.sin(phase) * (Math.cosh(kz) / Math.sinh(kh));

        // Total velocity (wave + current)
        const V_total = velocity + params.U_c;

        // Morrison's equation
        const F_drag = 0.5 * params.rho * Cd_corrected * params.D * Math.abs(V_total) * V_total * params.d;
        const F_inertia = params.rho * Cm_corrected * A * acceleration * params.d;

        const F_wave = F_drag + F_inertia;

        // Air drag (only above water)
        const F_air = 0.5 * params.rho_air * params.Cd_air * params.L * params.h_exp * (params.V_wind ** 2);

        timeData.push({
            time: t,
            waveForce: F_wave,
            airForce: F_air,
            velocity: velocity,
            acceleration: acceleration
        });

        peakWaveForce = Math.max(peakWaveForce, Math.abs(F_wave));
        peakAirForce = Math.max(peakAirForce, F_air);
    }

    // RMS calculation
    let sumSquares = 0;
    timeData.forEach(d => {
        sumSquares += (d.waveForce + d.airForce) ** 2;
    });
    const rmsForce = Math.sqrt(sumSquares / numPoints);

    // Return results
    return {
        timeData,
        k,
        wavelength,
        KC,
        ka,
        Re,
        peakWaveForce,
        peakAirForce,
        totalPeakForce: peakWaveForce + peakAirForce,
        rmsForce,
        correctionFactor,
        U_m,
        A_m
    };
}

// Solve dispersion relation: omega^2 = g*k*tanh(k*h)
function solveDispersion(omega, h) {
    let k = omega * omega / g; // initial guess

    for (let iter = 0; iter < 10; iter++) {
        const f = omega * omega - g * k * Math.tanh(k * h);
        const df = -g * (Math.tanh(k * h) + k * (1 - Math.tanh(k * h) ** 2) * h);
        const k_new = k - f / df;

        if (Math.abs(k_new - k) < 1e-8) break;
        k = k_new;
    }

    return k;
}

// MacCamy-Fuchs diffraction correction
// Based on diffraction theory for cylinders in waves
function macCamyFuchsCorrection(ka, KC) {
    // For small ka, diffraction effects reduce forces
    // For large ka, cylinder acts like it's not there (force coefficient → 1)

    // Empirical correction formula based on MacCamy & Fuchs (1954)
    // and subsequent research

    const ka_sq = ka * ka;

    // Diffraction factor for inertia force (more significant)
    let C_m_factor;
    if (ka < 0.5) {
        // Low frequency: maximum diffraction effects
        C_m_factor = 1.0 - 0.35 * ka_sq;
    } else if (ka < 3) {
        // Intermediate: gradual transition
        C_m_factor = 1.0 - 0.12 * ka - 0.18 * ka_sq;
    } else {
        // High frequency: minimal effects
        C_m_factor = 1.0 - 0.05 * ka;
    }

    C_m_factor = Math.max(0.7, Math.min(1.1, C_m_factor));

    // Drag force modification (smaller effect than inertia)
    let C_d_factor = 1.0 + 0.1 * Math.sin(ka / 2);

    // Combined correction (weighted toward inertia effect)
    const correction = 0.7 * C_m_factor + 0.3 * C_d_factor;

    return correction;
}

// Wave theory parameters helper
function getWaveParameters(H, T, h) {
    const omega = (2 * Math.PI) / T;
    const k = solveDispersion(omega, h);
    const wavelength = (2 * Math.PI) / k;
    const c = omega / k; // wave celerity
    const Cg = c * (0.5 + k * h / Math.sinh(2 * k * h)); // group velocity

    return {
        k,
        omega,
        wavelength,
        c,
        Cg,
        a: H / 2,
        T,
        h
    };
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateWaveForces,
        getWaveParameters,
        solveDispersion
    };
}
