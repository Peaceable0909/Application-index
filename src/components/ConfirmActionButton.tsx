'use client';
import type { ComponentProps } from 'react';
import Btn from './Btn';

type Props = Omit<ComponentProps<typeof Btn>, 'formAction' | 'onClick'> & {
  formAction: ComponentProps<typeof Btn>['formAction'];
  confirmMessage: string;
};

/** Confirm a bulk form action with the live count of checked student rows. */
export default function ConfirmActionButton({ formAction, confirmMessage, ...props }: Props) {
  return (
    <Btn
      {...props}
      formAction={formAction}
      onClick={(event) => {
        const count = event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked').length || 0;
        if (count && !window.confirm(confirmMessage.replace('{{count}}', String(count)))) event.preventDefault();
      }}
    />
  );
}
