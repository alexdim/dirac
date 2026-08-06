import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => {
	return (
		<input
			className={cn(
				"flex w-full rounded-md border border-input-foreground/20 bg-input-background px-3 py-2 text-base text-input-foreground shadow-sm transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-input-placeholder focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm text-ellipsis text-pretty",
				className,
			)}
			ref={ref}
			type={type}
			{...props}
		/>
	)
})
Input.displayName = "Input"

export { Input }
