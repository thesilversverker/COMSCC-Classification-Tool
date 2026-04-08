// Logical component: map worksheet sheet + prompt text to a stable subcategory label for UI grouping.

/**
 * @param {string} sheetSlug Category id / slug (e.g. brakes, engine).
 * @param {string} prompt Question prompt text.
 * @returns {string}
 */
export function assignSubcategory(sheetSlug, prompt) {
  const p = String(prompt).toLowerCase().replace(/\s+/g, ' ').trim();
  const slug = String(sheetSlug).toLowerCase();

  switch (slug) {
    case 'brakes':
      if (/\babs\b|anti[- ]?lock/.test(p)) return 'ABS';
      if (
        /rotor|pad|shoe|drum|caliper|ducting|brake line|bracket|drilled|slotted|thickness|diameter|two[- ]piece|one[- ]piece/.test(
          p
        )
      ) {
        return 'Rotors/Pads/Shoes';
      }
      return 'Other';

    case 'engine': {
      if (/turbo|supercharger|boost|wastegate|blow[- ]off|intercooler|charger\b/.test(p)) return 'Forced induction';
      if (/\becu\b|engine computer|rom|chip|piggyback|standalone|ems\b|maf|map sensor|wideband|knock/.test(p))
        return 'ECU & electronics';
      if (/header|exhaust|catalytic|muffler|downpipe|cat pipe/.test(p)) return 'Exhaust';
      if (/intake|throttle|fuel rail|injector|carb|itb|velocity stack|manifold/.test(p)) return 'Intake & fuel';
      if (/camshaft|\bcam\b|valve|displacement|compression|stroker|piston|rod|crank|porting|head work|dry sump|oil pan/.test(p))
        return 'Engine internals';
      if (/radiator|cooling fan|\bfan\b|pulley|accessory drive|water pump/.test(p)) return 'Cooling & accessories';
      return 'Other';
    }

    case 'drivetrain': {
      if (/traction control/.test(p)) return 'Traction & control';
      if (/transmission|gearbox|cvt\b|manual |smg|dct|dogbox|sequential|shifter|shift kit|clutch/.test(p))
        return 'Transmission & clutch';
      if (/differential|lsd|final drive|center diff|torsen/.test(p)) return 'Differential & driveline';
      if (/driveshaft|axle|cv joint|mount|flywheel/.test(p)) return 'Shafts & mounts';
      return 'Other';
    }

    case 'suspension': {
      if (/shock|strut|damper|spring|coilover|torsion bar|ride height/.test(p)) return 'Dampers & springs';
      if (/sway|control arm|camber|toe|caster|trailing|wishbone|panhard|watts|link geometry/.test(p))
        return 'Arms, links & alignment';
      if (/bushing|spherical|alignment kit|eccentric/.test(p)) return 'Bushings & hardware';
      if (/brace|subframe|tower bar|chassis/.test(p)) return 'Bracing & subframe';
      if (/steering rack|angle kit|bump steer/.test(p)) return 'Steering';
      return 'Other';
    }

    case 'exterior': {
      if (/active aero|sticker|wrap|livery|graphics/.test(p)) return 'Active aero & graphics';
      if (/splitter|canard|air dam|front lip|undertray|front bumper/.test(p)) return 'Front aero';
      if (/spoiler|wing|diffuser|rear bumper/.test(p)) return 'Rear aero';
      if (/hood|bonnet|fender|door|trunk|skirt|hardtop|roof|vortex/.test(p)) return 'Body & panels';
      return 'Other';
    }

    case 'vehicles':
      return 'Vehicle';

    case 'weight':
      if (/showroom/i.test(p)) return 'Showroom';
      if (/competition/i.test(p)) return 'Competition';
      if (/ballast/i.test(p)) return 'Ballast';
      return 'Weight';

    case 'tires':
      if (/width/i.test(p)) return 'Sizing';
      if (/manual/i.test(p)) return 'Manual points';
      return 'Class & model';

    default:
      return 'Other';
  }
}
