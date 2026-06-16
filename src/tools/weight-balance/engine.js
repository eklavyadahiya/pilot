/**
 * Weight & Balance calculation engine — parity with W_and_B_Versie_10.03_EFIS.xls
 */

export const DEFAULT_INPUTS = {
  aircraftId: "PH-MFT",
  pilotSeatPosition: 1,
  passengerSeatPosition: 1,
  pilotKg: 85,
  frontPassengerKg: 74,
  leftRearPassengerKg: 0,
  rightRearPassengerKg: 0,
  luggageArea1Kg: 5,
  luggageArea2Kg: 0,
  fuelDensityKgPerL: 0.72,
  fuelInputUnit: "kg",
  rampFuelMode: "calculated",
  manualRampFuelKg: 0,
  climbHours: 0,
  climbMinutes: 15,
  cruiseHours: 0,
  cruiseMinutes: 30,
  descentHours: 0,
  descentMinutes: 20,
  holdingHours: 0,
  holdingMinutes: 45,
  alternateHours: 0,
  alternateMinutes: 0,
  extraFuelKg: 5
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(num(value) * factor) / factor;
}

function minutesToTotal(hours, minutes) {
  return num(hours) * 60 + num(minutes);
}

function sumDurationHours(hourPairs) {
  const totalMinutes = hourPairs.reduce(
    (acc, [hours, minutes]) => acc + minutesToTotal(hours, minutes),
    0
  );
  const wholeHours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes % 60;
  const adjustedHours =
    wholeHours + round((remainderMinutes - 29.5) / 60, 0);
  return {
    hours: adjustedHours,
    minutes: remainderMinutes
  };
}

export function getAircraftById(aircraftList, aircraftId) {
  return aircraftList.find((item) => item.id === aircraftId) || aircraftList[0];
}

export function getTypeByRef(typeList, typeRef) {
  return (
    typeList.find((item) => item.chooseIndex === typeRef) ||
    typeList.find((item) => item.id === typeRef) ||
    typeList[0]
  );
}

export function getArmForSeatPosition(type, positionIndex) {
  const arms = type.arms;
  const index = num(positionIndex, 1);
  if (index === 2) {
    return num(arms.pilotMiddleM);
  }
  if (index === 3) {
    return num(arms.pilotBackM);
  }
  return num(arms.pilotFrontM);
}

export function computeMinArmForWeight(weightKg, type) {
  const kinkWeight = num(type.envelope.kinkWeightKg);
  const t13 = num(type.limits.minArmBelowKinkM);
  const s13 = num(type.limits.minArmSlopeAboveKink);
  if (weightKg < kinkWeight) {
    return t13;
  }
  return t13 + (weightKg - kinkWeight) * s13;
}

function fuelKgFromDuration(kgPerMin, hours, minutes) {
  return num(kgPerMin) * minutesToTotal(hours, minutes);
}

function kgToLiters(kg, density) {
  return num(kg) / num(density, 0.72);
}

export function litersToKg(liters, density) {
  return num(liters) * num(density, 0.72);
}

function kgToGallons(kg, density, litersPerGallon = 3.78) {
  return kgToLiters(kg, density) / litersPerGallon;
}

export function computeWeightBalance(rawInputs, aircraftList, typeList, constants = {}) {
  const inputs = { ...DEFAULT_INPUTS, ...rawInputs };
  const density = num(inputs.fuelDensityKgPerL, constants.fuelDensityKgPerL ?? 0.72);
  const litersPerGallon = num(constants.litersPerGallon, 3.78);
  const reserveFraction = num(constants.reserveTripFraction, 0.06);

  const aircraft = getAircraftById(aircraftList, inputs.aircraftId);
  const type = getTypeByRef(typeList, aircraft.typeRef);

  const emptyWeight = num(aircraft.emptyWeightKg);
  const emptyMoment = num(aircraft.emptyMomentMkg);
  const emptyArm = emptyWeight > 0 ? emptyMoment / emptyWeight : 0;

  const pilotArm = getArmForSeatPosition(type, inputs.pilotSeatPosition);
  const passengerArm = getArmForSeatPosition(type, inputs.passengerSeatPosition);
  const rearArm = num(type.arms.rearPassengersM);
  const bag1Arm = num(type.arms.baggageArea1M);
  const bag2Arm = num(type.arms.baggageArea2M);
  const fuelArm = num(type.arms.fuelM);

  const pilotKg = num(inputs.pilotKg);
  const frontPassengerKg = num(inputs.frontPassengerKg);
  const rearPassengersKg =
    num(inputs.leftRearPassengerKg) + num(inputs.rightRearPassengerKg);
  const luggage1Kg = num(inputs.luggageArea1Kg);
  const luggage2Kg = num(inputs.luggageArea2Kg);

  const pilotMoment = pilotArm * pilotKg;
  const frontPassengerMoment = passengerArm * frontPassengerKg;
  const rearMoment = rearArm * rearPassengersKg;
  const luggage1Moment = bag1Arm * luggage1Kg;
  const luggage2Moment = bag2Arm * luggage2Kg;

  const zeroFuelWeight =
    emptyWeight +
    pilotKg +
    frontPassengerKg +
    rearPassengersKg +
    luggage1Kg +
    luggage2Kg;
  const zeroFuelMoment =
    emptyMoment +
    pilotMoment +
    frontPassengerMoment +
    rearMoment +
    luggage1Moment +
    luggage2Moment;
  const zeroFuelArm = zeroFuelWeight > 0 ? zeroFuelMoment / zeroFuelWeight : 0;

  const maxFuelKg = num(aircraft.maxFuelKg);

  const climbFuel = fuelKgFromDuration(
    type.fuel.climbKgMin,
    inputs.climbHours,
    inputs.climbMinutes
  );
  const cruiseFuel = fuelKgFromDuration(
    type.fuel.cruiseKgMin,
    inputs.cruiseHours,
    inputs.cruiseMinutes
  );
  const descentFuel = fuelKgFromDuration(
    type.fuel.descentKgMin,
    inputs.descentHours,
    inputs.descentMinutes
  );
  const tripFuel = climbFuel + cruiseFuel + descentFuel;
  const reserveFuel = tripFuel * reserveFraction;
  const holdingFuel = fuelKgFromDuration(
    type.fuel.holdKgMin,
    inputs.holdingHours,
    inputs.holdingMinutes
  );
  const alternateFuel = fuelKgFromDuration(
    type.fuel.cruiseKgMin,
    inputs.alternateHours,
    inputs.alternateMinutes
  );
  const taxiFuel = num(type.fuel.taxiKg);
  const extraFuel = num(inputs.extraFuelKg);

  const minRequiredFuel =
    tripFuel + reserveFuel + holdingFuel + alternateFuel + taxiFuel;
  const calculatedRampFuel = minRequiredFuel + extraFuel;
  const useManualRamp =
    inputs.rampFuelMode === "manual" && num(inputs.manualRampFuelKg) > 0;
  const rampFuel = useManualRamp ? num(inputs.manualRampFuelKg) : calculatedRampFuel;

  const tripDuration = sumDurationHours([
    [inputs.climbHours, inputs.climbMinutes],
    [inputs.cruiseHours, inputs.cruiseMinutes],
    [inputs.descentHours, inputs.descentMinutes]
  ]);
  const minRequiredDuration = sumDurationHours([
    [tripDuration.hours, tripDuration.minutes],
    [0, 0],
    [inputs.holdingHours, inputs.holdingMinutes],
    [inputs.alternateHours, inputs.alternateMinutes],
    [0, 0]
  ]);
  const extraDurationHours = round(
    extraFuel / num(type.fuel.cruiseKgMin) / 60 - 29.9 / 60,
    0
  );
  const extraDurationMinutes = round(
    (extraFuel / num(type.fuel.cruiseKgMin)) % 60,
    0
  );

  const taxiOutKg = round(12 * num(type.fuel.descentKgMin), 1);
  const takeoffFuel = rampFuel - taxiOutKg;
  const burnoff = tripFuel + reserveFuel;
  const remainingFuel = takeoffFuel - burnoff;

  const rampFuelMoment = fuelArm * rampFuel;
  const rampWeight = zeroFuelWeight + rampFuel;
  const rampMoment = zeroFuelMoment + rampFuelMoment;
  const rampArm = rampWeight > 0 ? rampMoment / rampWeight : 0;

  const taxiMoment = fuelArm * taxiFuel;
  const takeoffWeight = rampWeight - taxiFuel;
  const takeoffMoment = rampMoment - taxiMoment;
  const takeoffArm = takeoffWeight > 0 ? takeoffMoment / takeoffWeight : 0;

  const tripFuelMoment = fuelArm * tripFuel;
  const landingWeight = takeoffWeight - tripFuel;
  const landingMoment = takeoffMoment - tripFuelMoment;
  const landingArm = landingWeight > 0 ? landingMoment / landingWeight : 0;

  const fullFuelWeight = zeroFuelWeight + maxFuelKg;
  const fullFuelMoment = zeroFuelMoment + fuelArm * maxFuelKg;
  const fullFuelArm = fullFuelWeight > 0 ? fullFuelMoment / fullFuelWeight : 0;

  const maxTowKg = num(type.maxTowKg);
  const totalLuggageKg = luggage1Kg + luggage2Kg;

  const minArmZfw = computeMinArmForWeight(zeroFuelWeight, type);
  const minArmTow = computeMinArmForWeight(takeoffWeight, type);
  const minArmLw = computeMinArmForWeight(landingWeight, type);
  const minArmFullFuel = computeMinArmForWeight(fullFuelWeight, type);

  const enduranceHours =
    minRequiredDuration.hours +
    extraDurationHours +
    round((minRequiredDuration.minutes + extraDurationMinutes - 29.5) / 60, 0);
  const enduranceMinutes = round(
    (minRequiredDuration.minutes + extraDurationMinutes) % 60,
    0
  );

  const results = {
    aircraft,
    type,
    inputs,
    constants: { density, litersPerGallon, reserveFraction },
    empty: { weightKg: emptyWeight, armM: emptyArm, momentMkg: emptyMoment },
    pilot: { weightKg: pilotKg, armM: pilotArm, momentMkg: pilotMoment },
    frontPassenger: {
      weightKg: frontPassengerKg,
      armM: passengerArm,
      momentMkg: frontPassengerMoment
    },
    rearPassengers: {
      weightKg: rearPassengersKg,
      armM: rearArm,
      momentMkg: rearMoment
    },
    luggageArea1: {
      weightKg: luggage1Kg,
      armM: bag1Arm,
      momentMkg: luggage1Moment
    },
    luggageArea2: {
      weightKg: luggage2Kg,
      armM: bag2Arm,
      momentMkg: luggage2Moment
    },
    zeroFuel: {
      weightKg: zeroFuelWeight,
      armM: zeroFuelArm,
      momentMkg: zeroFuelMoment,
      minArmM: minArmZfw,
      maxArmM: num(type.limits.maxArmM)
    },
    ramp: {
      weightKg: rampWeight,
      armM: rampArm,
      momentMkg: rampMoment
    },
    takeoff: {
      weightKg: takeoffWeight,
      armM: takeoffArm,
      momentMkg: takeoffMoment,
      minArmM: minArmTow,
      maxArmM: num(type.limits.maxArmM),
      maxWeightKg: maxTowKg
    },
    landing: {
      weightKg: landingWeight,
      armM: landingArm,
      momentMkg: landingMoment,
      minArmM: minArmLw,
      maxArmM: num(type.limits.maxArmM)
    },
    fullFuel: {
      weightKg: fullFuelWeight,
      armM: fullFuelArm,
      momentMkg: fullFuelMoment,
      minArmM: minArmFullFuel,
      maxArmM: num(type.limits.maxArmM),
      maxRampKg: maxTowKg + taxiFuel
    },
    fuel: {
      maxKg: maxFuelKg,
      maxLiters: round(kgToLiters(maxFuelKg, density), 1),
      maxGallons: round(kgToGallons(maxFuelKg, density, litersPerGallon), 1),
      tripKg: tripFuel,
      tripLiters: round(kgToLiters(tripFuel, density), 1),
      tripGallons: round(kgToGallons(tripFuel, density, litersPerGallon), 1),
      reserveKg: reserveFuel,
      reserveLiters: round(kgToLiters(reserveFuel, density), 1),
      holdingKg: holdingFuel,
      holdingLiters: round(kgToLiters(holdingFuel, density), 1),
      alternateKg: alternateFuel,
      alternateLiters: round(kgToLiters(alternateFuel, density), 1),
      taxiKg: taxiFuel,
      taxiLiters: round(kgToLiters(taxiFuel, density), 1),
      extraKg: extraFuel,
      extraLiters: round(kgToLiters(extraFuel, density), 1),
      minRequiredKg: minRequiredFuel,
      minRequiredLiters: round(kgToLiters(minRequiredFuel, density), 1),
      calculatedRampKg: calculatedRampFuel,
      calculatedRampLiters: round(kgToLiters(calculatedRampFuel, density), 1),
      rampKg: rampFuel,
      rampLiters: round(kgToLiters(rampFuel, density), 1),
      rampFromManualOverride: useManualRamp,
      taxiOutKg,
      taxiOutLiters: round(kgToLiters(taxiOutKg, density), 1),
      takeoffKg: takeoffFuel,
      takeoffLiters: round(kgToLiters(takeoffFuel, density), 1),
      burnoffKg: burnoff,
      burnoffLiters: round(kgToLiters(burnoff, density), 1),
      remainingKg: remainingFuel,
      remainingLiters: round(kgToLiters(remainingFuel, density), 1),
      climbKg: climbFuel,
      cruiseKg: cruiseFuel,
      descentKg: descentFuel,
      densityKgPerL: density
    },
    limits: {
      maxTowKg,
      maxRearPassengerKg: num(type.limits.maxRearPassengerKg),
      maxBaggageArea1Kg: num(type.limits.maxBaggageArea1Kg),
      maxBaggageArea2Kg: num(type.limits.maxBaggageArea2Kg),
      maxCombinedBaggageKg: num(type.limits.maxCombinedBaggageKg),
      maxPilotPaxKg: num(type.limits.maxPilotPaxKg),
      totalLuggageKg
    },
    endurance: {
      trip: tripDuration,
      minRequired: minRequiredDuration,
      extra: { hours: extraDurationHours, minutes: extraDurationMinutes },
      totalText: `${enduranceHours} h, ${enduranceMinutes} m.`
    },
    metadata: {
      weighDate: aircraft.weighDate,
      equipment: aircraft.equipment,
      color: aircraft.color,
      registration: aircraft.registration,
      model: aircraft.model
    }
  };

  results.warnings = evaluateWarnings(results);
  results.takeoffSummary = buildTakeoffSummary(results, type);
  results.envelope = buildEnvelopeSeries(type, results);
  results.efis = computeEfis(results);
  results.chartPoints = buildChartPoints(type, results);

  return results;
}

export function buildTakeoffSummary(results, type) {
  const { takeoff, landing, fuel, zeroFuel } = results;
  const marginKg = takeoff.maxWeightKg - takeoff.weightKg;
  const armInRange =
    takeoff.armM >= takeoff.minArmM && takeoff.armM <= takeoff.maxArmM;
  const weightOk = takeoff.weightKg <= takeoff.maxWeightKg;

  return {
    weightKg: takeoff.weightKg,
    maxWeightKg: takeoff.maxWeightKg,
    marginKg,
    armM: takeoff.armM,
    minArmM: takeoff.minArmM,
    maxArmM: takeoff.maxArmM,
    withinWeightLimit: weightOk,
    withinArmLimits: armInRange,
    isOperational: weightOk && armInRange,
    takeoffFuelKg: fuel.takeoffKg,
    takeoffFuelLiters: fuel.takeoffLiters,
    landingWeightKg: landing.weightKg,
    zeroFuelWeightKg: zeroFuel.weightKg,
    performance: {
      climb: {
        tasKts: num(type.performance.climbKts),
        fuelKgHr: round(60 * num(type.fuel.climbKgMin), 2),
        setting: type.fuel.climbSetting || "",
        ftMin: num(type.performance.climbFtMin)
      },
      cruise: {
        tasKts: num(type.performance.cruiseKts),
        fuelKgHr: round(60 * num(type.fuel.cruiseKgMin), 2),
        setting: type.fuel.cruiseSetting || "",
        fuelKgMin: num(type.fuel.cruiseKgMin)
      },
      descent: {
        tasKts: num(type.performance.descentKts),
        fuelKgHr: round(60 * num(type.fuel.descentKgMin), 2),
        setting: type.fuel.descentSetting || "",
        ftMin: num(type.performance.descentFtMin)
      }
    }
  };
}

export function evaluateWarnings(results) {
  const operational = [];
  const informational = [];
  const reg = results.metadata.registration;
  const isDv20Pair = reg === "PH-MFT" || reg === "PH-SKM";
  const {
    zeroFuel,
    takeoff,
    landing,
    fullFuel,
    fuel,
    limits,
    pilot,
    frontPassenger,
    rearPassengers,
    luggageArea1,
    luggageArea2
  } = results;

  function pushOperational(id, target, severity, message) {
    operational.push({ id, target, severity, message });
  }

  function pushInformational(id, target, severity, message) {
    informational.push({ id, target, severity, message });
  }

  if (zeroFuel.weightKg > takeoff.maxWeightKg) {
    pushOperational("zfw_over_max", "zeroFuel.weightKg", "danger", "Zero fuel weight exceeds max TOW");
  }
  if (takeoff.weightKg > takeoff.maxWeightKg) {
    pushOperational(
      "tow_over_max",
      "takeoff.weightKg",
      "danger",
      `TOW ${round(takeoff.weightKg, 1)} kg exceeds maximum ${takeoff.maxWeightKg} kg`
    );
  }
  if (landing.weightKg > takeoff.maxWeightKg) {
    pushOperational("lw_over_max", "landing.weightKg", "danger", "Landing weight exceeds maximum TOW");
  }
  if (fuel.rampKg > fuel.maxKg) {
    pushOperational("ramp_fuel_over_capacity", "fuel.rampKg", "danger", "Planned ramp fuel exceeds tank capacity");
  }

  const operationalArmChecks = [
    ["zfw_arm_high", zeroFuel, "zeroFuel.armM", "ZFW"],
    ["zfw_arm_low", zeroFuel, "zeroFuel.armM", "ZFW"],
    ["tow_arm_high", takeoff, "takeoff.armM", "TOW"],
    ["tow_arm_low", takeoff, "takeoff.armM", "TOW"],
    ["lw_arm_high", landing, "landing.armM", "Landing"],
    ["lw_arm_low", landing, "landing.armM", "Landing"]
  ];

  for (const [id, state, target, label] of operationalArmChecks) {
    if (state.armM > state.maxArmM) {
      pushOperational(
        `${id}_tail`,
        target,
        "danger",
        `${label} arm ${round(state.armM, 3)} m exceeds maximum ${round(state.maxArmM, 3)} m (tail-heavy)`
      );
    }
    if (state.armM < state.minArmM) {
      pushOperational(
        `${id}_nose`,
        target,
        "caution",
        `${label} arm ${round(state.armM, 3)} m below minimum ${round(state.minArmM, 3)} m (nose-heavy)`
      );
    }
  }

  if (luggageArea1.weightKg > limits.maxBaggageArea1Kg) {
    pushOperational("bag1_over", "luggageArea1.weightKg", "danger", "Baggage area 1 exceeds limit");
  }
  if (luggageArea2.weightKg > limits.maxBaggageArea2Kg) {
    pushOperational("bag2_over", "luggageArea2.weightKg", "danger", "Baggage area 2 exceeds limit");
  }
  if (limits.totalLuggageKg > limits.maxCombinedBaggageKg) {
    pushOperational(
      "bag_combined_over",
      "limits.totalLuggageKg",
      "caution",
      `Combined baggage ${limits.totalLuggageKg} kg exceeds limit ${limits.maxCombinedBaggageKg} kg`
    );
  }

  if (isDv20Pair && pilot.weightKg > limits.maxPilotPaxKg) {
    pushOperational("pilot_over_dv20", "pilot.weightKg", "danger", "Pilot weight exceeds DV20 seat limit");
  }
  if (isDv20Pair && frontPassenger.weightKg > limits.maxPilotPaxKg) {
    pushOperational(
      "front_over_dv20",
      "frontPassenger.weightKg",
      "danger",
      "Front passenger exceeds DV20 seat limit"
    );
  }
  if (isDv20Pair && rearPassengers.weightKg > 0) {
    pushOperational(
      "rear_not_allowed_dv20",
      "rearPassengers.weightKg",
      "danger",
      "Rear passengers not allowed on this aircraft"
    );
  }

  if (fullFuel.weightKg > fullFuel.maxRampKg) {
    pushInformational(
      "full_fuel_over_ramp",
      "fullFuel.weightKg",
      "info",
      `Reference only: full-tank weight ${round(fullFuel.weightKg, 1)} kg would exceed max ramp ${round(fullFuel.maxRampKg, 1)} kg`
    );
  }
  if (fullFuel.armM > fullFuel.maxArmM) {
    pushInformational(
      "ffw_arm_high",
      "fullFuel.armM",
      "info",
      "Reference only: full-tank loading would be tail-heavy"
    );
  }
  if (fullFuel.armM < fullFuel.minArmM) {
    pushInformational(
      "ffw_arm_low",
      "fullFuel.armM",
      "info",
      "Reference only: full-tank loading would be nose-heavy"
    );
  }

  return {
    operational,
    informational,
    all: [...operational, ...informational]
  };
}

export function buildEnvelopeSeries(type, results) {
  const env = type.envelope;
  const lowW = num(env.lowWeightKg);
  const kinkW = num(env.kinkWeightKg);
  const maxW = num(env.maxTowKg);
  const utilityMaxW = num(env.maxUtilityWeightKg);

  const normal = [
    { momentMkg: num(env.momentLowAtLowWeight), weightKg: lowW },
    { momentMkg: num(env.momentHighAtLowWeight), weightKg: lowW },
    { momentMkg: num(env.kinkMomentMkg), weightKg: kinkW },
    { momentMkg: num(env.momentLowAtMaxTow), weightKg: maxW },
    { momentMkg: num(env.momentHighAtMaxTow), weightKg: maxW },
    { momentMkg: num(env.momentHighAtLowWeight), weightKg: lowW }
  ];

  const utility =
    utilityMaxW > 0
      ? [
          { momentMkg: num(env.momentLowAtLowWeight), weightKg: lowW },
          { momentMkg: num(env.momentHighAtLowUtility), weightKg: lowW },
          { momentMkg: num(env.kinkMomentMkg), weightKg: kinkW },
          { momentMkg: num(env.momentLowAtMaxUtility), weightKg: utilityMaxW },
          { momentMkg: num(env.momentHighAtMaxUtility), weightKg: utilityMaxW },
          { momentMkg: num(env.momentHighAtLowUtility), weightKg: lowW }
        ]
      : [];

  return {
    normal,
    utility,
    operatingPoints: [
      { label: "ZFW", momentMkg: results.zeroFuel.momentMkg, weightKg: results.zeroFuel.weightKg },
      { label: "FullFuel", momentMkg: results.fullFuel.momentMkg, weightKg: results.fullFuel.weightKg },
      { label: "TOW", momentMkg: results.takeoff.momentMkg, weightKg: results.takeoff.weightKg },
      { label: "LW", momentMkg: results.landing.momentMkg, weightKg: results.landing.weightKg },
      { label: "Ramp", momentMkg: results.ramp.momentMkg, weightKg: results.ramp.weightKg }
    ],
    maxYAxisKg: num(env.maxYAxisKg)
  };
}

export function buildChartPoints(type, results) {
  const env = type.envelope;
  const lowW = num(env.lowWeightKg);
  const kinkW = num(env.kinkWeightKg);
  const maxW = num(env.maxTowKg);
  const utilityMaxW = num(env.maxUtilityWeightKg);

  return {
    normalBoundary: [
      { x: num(env.momentLowAtLowWeight), y: lowW },
      { x: num(env.kinkMomentMkg), y: kinkW },
      { x: num(env.momentLowAtMaxTow), y: maxW },
      { x: num(env.momentHighAtMaxTow), y: maxW },
      { x: num(env.momentHighAtLowWeight), y: lowW },
      { x: num(env.momentLowAtLowWeight), y: lowW }
    ],
    utilityBoundary:
      utilityMaxW > 0
        ? [
            { x: num(env.momentLowAtLowWeight), y: lowW },
            { x: num(env.kinkMomentMkg), y: kinkW },
            { x: num(env.momentLowAtMaxUtility), y: utilityMaxW },
            { x: num(env.momentHighAtMaxUtility), y: utilityMaxW },
            { x: num(env.momentHighAtLowUtility), y: lowW },
            { x: num(env.momentLowAtLowWeight), y: lowW }
          ]
        : [],
    fullTankLine: [
      { x: num(env.momentHighAtLowWeight), y: lowW },
      { x: results.fullFuel.momentMkg, y: results.fullFuel.weightKg }
    ],
    emptyTankZfw: { x: results.zeroFuel.momentMkg, y: results.zeroFuel.weightKg },
    fullTankRamp: { x: results.fullFuel.momentMkg, y: results.fullFuel.weightKg },
    takeoff: { x: results.takeoff.momentMkg, y: results.takeoff.weightKg },
    landing: { x: results.landing.momentMkg, y: results.landing.weightKg },
    tripLine: { x: results.landing.momentMkg, y: results.landing.weightKg },
    towLine: { x: results.takeoff.momentMkg, y: results.takeoff.weightKg }
  };
}

export function computeEfis(results) {
  const { aircraft, type, empty, fuel, takeoff, limits } = results;
  const startTaxiKg = round((12 * num(type.fuel.descentKgMin)), 3);
  const efisArms = {
    apsCm: round((100 * empty.momentMkg) / empty.weightKg, 10),
    fuelCm: round(100 * num(type.arms.fuelM), 10),
    row1Cm: round(100 * num(type.arms.pilotMiddleM), 10),
    row2Cm: round(100 * num(type.arms.rearPassengersM), 10),
    bag1Cm: round(100 * num(type.arms.baggageArea1M), 10),
    bag2Cm: round(100 * num(type.arms.baggageArea2M), 10)
  };

  const env = type.envelope;
  const lowW = num(env.lowWeightKg);
  const kinkW = num(env.kinkWeightKg);
  const maxW = num(env.maxTowKg);

  const envelopePoints = [
    { weightKg: lowW, armCm: round((100 * num(env.momentLowAtLowWeight)) / lowW, 2) },
    { weightKg: kinkW, armCm: round((100 * num(env.kinkMomentMkg)) / kinkW, 2) },
    { weightKg: maxW, armCm: round((100 * num(env.momentLowAtMaxTow)) / maxW, 2) },
    { weightKg: maxW, armCm: round((100 * num(env.momentHighAtMaxTow)) / maxW, 2) },
    { weightKg: lowW, armCm: round((100 * num(env.momentHighAtLowWeight)) / lowW, 2) }
  ];

  const minWeight = round(Math.min(...envelopePoints.map((p) => p.weightKg), 550) - 10, -1);
  const maxWeight = num(type.maxTowKg);
  const minArm = round(Math.min(...envelopePoints.map((p) => p.armCm)) - 1, 2);
  const maxArm = round(Math.max(...envelopePoints.map((p) => p.armCm)), 2);

  return {
    registration: aircraft.registration,
    model: aircraft.model,
    fuelType: "Avgas",
    startTaxiKg,
    units: "kg",
    performance: {
      climbTasKts: num(type.performance.climbKts),
      climbConsKgHr: round(60 * num(type.fuel.climbKgMin), 2),
      cruiseTasKts: num(type.performance.cruiseKts),
      cruiseConsKgHr: round(60 * num(type.fuel.cruiseKgMin), 2),
      descentTasKts: num(type.performance.descentKts),
      descentConsKgHr: round(60 * num(type.fuel.descentKgMin), 2)
    },
    schedule: {
      units: "Metric",
      rampKg: round(takeoff.maxWeightKg + startTaxiKg, 3),
      takeoffKg: takeoff.maxWeightKg,
      landingKg: takeoff.maxWeightKg,
      zeroFuelKg: empty.weightKg
    },
    stations: efisArms,
    graph: {
      minWeightKg: minWeight,
      weightGridInterval: round((maxWeight - minWeight + 30) / 5, -1),
      minArmCm: minArm,
      armGridInterval: round((maxArm - minArm) / 5, 0)
    },
    envelope: envelopePoints
  };
}

export function getWarningTargets(warnings) {
  const map = new Map();
  const list = warnings?.operational || warnings?.all || warnings || [];
  for (const warning of list) {
    if (!map.has(warning.target)) {
      map.set(warning.target, warning.severity);
    } else if (warning.severity === "danger") {
      map.set(warning.target, "danger");
    }
  }
  return map;
}
