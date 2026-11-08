import { useEffect, useState } from 'react';
import { readHostEnvironment, type HostEnvironment } from './client';

let environmentRequest: Promise<HostEnvironment> | undefined;

export function useHostEnvironment(): HostEnvironment | null {
  const [environment, setEnvironment] = useState<HostEnvironment | null>(null);
  useEffect(() => {
    let active = true;
    environmentRequest ??= readHostEnvironment();
    void environmentRequest.then((value) => {
      if (active) setEnvironment(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return environment;
}
