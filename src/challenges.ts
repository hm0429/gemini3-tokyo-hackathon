export type Challenge = {
  id: string;
  title: string;
  description: string;
  points: number;
  locationCheck?: {
    label: string;
    lat: number;
    lng: number;
    radiusMeters: number;
  };
};

export const FIXED_CHALLENGES: Challenge[] = [
  {
    id: 'white-glasses-person',
    title: 'Street Scout',
    description: 'Find a person wearing glasses and white clothes, then get into the same frame.',
    points: 120,
  },
  {
    id: 'hachiko-squats',
    title: 'Hachiko Challenge',
    description: 'Do 5 squats in front of the Hachiko area.',
    points: 220,
    locationCheck: {
      label: 'Shibuya Hachiko Statue Area',
      lat: 35.659482,
      lng: 139.70056,
      radiusMeters: 180,
    },
  },
  {
    id: 'red-sign-pose',
    title: 'Red Sign Pose',
    description: 'At a place where a red sign is visible, raise both hands for 3 seconds.',
    points: 140,
  },
  {
    id: 'convenience-peace',
    title: 'Convenience Peace',
    description: 'Hold a convenience store bag and make a peace sign to the camera.',
    points: 150,
  },
  {
    id: 'drink-redbull',
    title: 'RedBull Challenge',
    description: 'Show me you drinking RedBull.',
    points: 160,
  },
  {
    id: 'vending-jump',
    title: 'Vending Machine Jump',
    description: 'Stand where a vending machine is visible and jump in place twice.',
    points: 170,
  },
  {
    id: 'bench-sit',
    title: 'Bench Break',
    description: 'Sit on a park or outdoor bench and wave your hand.',
    points: 130,
  },
  {
    id: 'banana-shake',
    title: 'Banana Shake',
    description: 'Shake a banana.',
    points: 140,
  },
  {
    id: 'banzai-pose',
    title: 'Banzai',
    description: 'Raise both hands above your head in a banzai pose.',
    points: 130,
  },
];
