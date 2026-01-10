import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

describe('UI: TooltipTrigger asChild + Button', () => {
  it('不应触发 Maximum update depth exceeded', () => {
    expect(() => {
      render(
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button">trigger</Button>
          </TooltipTrigger>
          <TooltipContent>content</TooltipContent>
        </Tooltip>
      );
    }).not.toThrow();
  });
});
