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
    id: 'banana-squat',
    title: 'Banana Squat',
    description: 'Do squats while holding a banana.',
    points: 150,
  },
  {
    id: 'banana-shake',
    title: 'Banana Shake',
    description: 'Shake a banana.',
    points: 140,
  },
  {
    id: 'hachiko-banana-shake',
    title: 'Hachiko Banana Shake',
    description: 'Shake a banana in front of Hachiko.',
    points: 220,
    locationCheck: {
      label: 'Shibuya Hachiko Statue Area',
      lat: 35.659482,
      lng: 139.70056,
      radiusMeters: 180,
    },
  },
  {
    id: 'banana-jump',
    title: 'Banana Jump',
    description: 'Jump at least twice while holding a banana.',
    points: 170,
  },
  {
    id: 'banana-peace-two-people',
    title: 'Banana Peace Duo',
    description: 'With a person wearing glasses, both of you hold bananas and make a peace sign.',
    points: 210,
  },
  {
    id: 'daruma-banana-shake',
    title: 'Daruma Banana Shake',
    description: 'Shake a banana in front of a daruma.',
    points: 180,
  },
];
