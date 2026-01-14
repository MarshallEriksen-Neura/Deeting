import SelectAgentModal from '../(.)select-agent/page';

export default function Page() {
  return (
    <div className="min-h-screen w-full bg-black relative">
       {/* Ensure the modal content renders */}
       <SelectAgentModal />
    </div>
  );
}
